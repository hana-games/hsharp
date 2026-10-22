using System;
using System.Collections.Generic;
using System.ComponentModel.Composition;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Text;
using Microsoft.VisualStudio.Text.Tagging;
using Microsoft.VisualStudio.Threading;
using Microsoft.VisualStudio.Utilities;
using HSharp.VisualStudio.Bridge;

namespace HSharp.VisualStudio.Editor
{
    [Export(typeof(ITaggerProvider))]
    [ContentType(HSharpContentType.Name)]
    [TagType(typeof(IErrorTag))]
    internal sealed class HSharpErrorTaggerProvider : ITaggerProvider
    {
        public ITagger<T> CreateTagger<T>(ITextBuffer buffer) where T : ITag
        {
            return buffer.Properties.GetOrCreateSingletonProperty(
                () => new HSharpErrorTagger(buffer)) as ITagger<T>;
        }
    }

    internal sealed class HSharpErrorTagger : ITagger<IErrorTag>, IDisposable
    {
        private readonly ITextBuffer buffer;
        private readonly object gate = new object();
        private List<TagSpan<IErrorTag>> tags = new List<TagSpan<IErrorTag>>();
        private ITextSnapshot snapshot;
        private CancellationTokenSource debounce;
        private bool disposed;

        public HSharpErrorTagger(ITextBuffer buffer)
        {
            this.buffer = buffer;
            buffer.Changed += OnBufferChanged;
            HSharpSettings.Changed += OnSettingsChanged;
            _ = Task.Run(() => RefreshAsync(buffer.CurrentSnapshot));
        }

        private void OnSettingsChanged(object sender, EventArgs e)
        {
            Schedule(buffer.CurrentSnapshot);
        }

        public event EventHandler<SnapshotSpanEventArgs> TagsChanged;

        public IEnumerable<ITagSpan<IErrorTag>> GetTags(NormalizedSnapshotSpanCollection spans)
        {
            if (spans == null || spans.Count == 0) return Enumerable.Empty<ITagSpan<IErrorTag>>();
            lock (gate)
            {
                if (snapshot == null || spans[0].Snapshot != snapshot)
                {
                    return Enumerable.Empty<ITagSpan<IErrorTag>>();
                }
                return tags.Where(tag => spans.IntersectsWith(tag.Span)).ToList();
            }
        }

        private void OnBufferChanged(object sender, TextContentChangedEventArgs e)
        {
            Schedule(buffer.CurrentSnapshot);
        }

        private void Schedule(ITextSnapshot next)
        {
            CancellationToken token;
            lock (gate)
            {
                if (disposed) return;
                debounce?.Cancel();
                debounce?.Dispose();
                debounce = new CancellationTokenSource();
                token = debounce.Token;
            }
            _ = RefreshAsync(next, token);
        }

        private async Task RefreshAsync(ITextSnapshot next, CancellationToken token = default(CancellationToken))
        {
            try
            {
                if (token.CanBeCanceled)
                {
                    await Task.Delay(HSharpSettings.DebounceMs, token).ConfigureAwait(false);
                }

                var text = next.GetText();
                var file = ActiveDocumentTracker.Instance.FilePath;
                var response = await BridgeClient.Shared.AnalyzeAsync(
                    text,
                    file,
                    HSharpSettings.ProfilePath,
                    null,
                    new string[0],
                    token).ConfigureAwait(false);

                if (token.IsCancellationRequested || !ReferenceEquals(buffer.CurrentSnapshot, next)) return;

                var built = BuildTags(next, response);
                await PublishAsync(next, built, token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // A newer snapshot superseded this request.
            }
            catch (Exception cause)
            {
                if (token.IsCancellationRequested) return;
                var failed = new List<TagSpan<IErrorTag>>();
                if (next.Length > 0)
                {
                    failed.Add(new TagSpan<IErrorTag>(
                        new SnapshotSpan(next, 0, 1),
                        new ErrorTag("syntax error", "h# bridge: " + cause.Message)));
                }
                await PublishAsync(next, failed, token).ConfigureAwait(false);
            }
        }

        private List<TagSpan<IErrorTag>> BuildTags(ITextSnapshot next, AnalyzeResponse response)
        {
            var built = new List<TagSpan<IErrorTag>>();
            foreach (var diagnostic in response.Diagnostics)
            {
                var start = diagnostic.Span?.Start?.Offset ?? 0;
                var end = diagnostic.Span?.End?.Offset ?? start;
                start = Math.Max(0, Math.Min(start, next.Length));
                end = Math.Max(start, Math.Min(end, next.Length));
                var length = Math.Max(1, end - start);
                if (start + length > next.Length) length = Math.Max(0, next.Length - start);
                if (length == 0) continue;

                var tooltip = diagnostic.Code + ": " + diagnostic.Message;
                if (!string.IsNullOrWhiteSpace(diagnostic.Hint))
                {
                    tooltip += Environment.NewLine + "hint: " + diagnostic.Hint;
                }

                built.Add(new TagSpan<IErrorTag>(
                    new SnapshotSpan(next, start, length),
                    new ErrorTag("syntax error", tooltip)));
            }
            return built;
        }

        private async Task PublishAsync(
            ITextSnapshot next,
            List<TagSpan<IErrorTag>> built,
            CancellationToken token)
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
            if (disposed || token.IsCancellationRequested) return;

            lock (gate)
            {
                snapshot = next;
                tags = built;
            }

            TagsChanged?.Invoke(
                this,
                new SnapshotSpanEventArgs(new SnapshotSpan(next, 0, next.Length)));
        }

        public void Dispose()
        {
            lock (gate)
            {
                if (disposed) return;
                disposed = true;
                debounce?.Cancel();
                debounce?.Dispose();
                debounce = null;
            }
            buffer.Changed -= OnBufferChanged;
            HSharpSettings.Changed -= OnSettingsChanged;
        }
    }
}
