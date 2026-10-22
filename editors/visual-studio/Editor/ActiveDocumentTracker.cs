using System;
using System.ComponentModel.Composition;
using Microsoft.VisualStudio.Text;
using Microsoft.VisualStudio.Text.Editor;
using Microsoft.VisualStudio.Utilities;

namespace HSharp.VisualStudio.Editor
{
    [Export(typeof(IWpfTextViewCreationListener))]
    [ContentType(HSharpContentType.Name)]
    [TextViewRole(PredefinedTextViewRoles.Document)]
    internal sealed class HSharpTextViewCreationListener : IWpfTextViewCreationListener
    {
        public void TextViewCreated(IWpfTextView textView)
        {
            ActiveDocumentTracker.Instance.Attach(textView);
        }
    }

    /// <summary>
    /// Tracks the most recently focused h# document for the preview tool window.
    /// The tracker is shared by MEF components and the package-hosted tool window.
    /// </summary>
    public sealed class ActiveDocumentTracker
    {
        public static ActiveDocumentTracker Instance { get; } = new ActiveDocumentTracker();

        private IWpfTextView currentView;
        private ITextBuffer currentBuffer;

        private ActiveDocumentTracker()
        {
        }

        public event EventHandler ActiveDocumentChanged;

        public event EventHandler ContentChanged;

        public ITextBuffer Buffer => currentBuffer;

        public string FilePath { get; private set; } = "untitled.hs";

        internal void Attach(IWpfTextView textView)
        {
            textView.GotAggregateFocus += OnGotFocus;
            textView.Closed += OnClosed;
            if (textView.HasAggregateFocus)
            {
                SetActive(textView);
            }
        }

        private void OnGotFocus(object sender, EventArgs e)
        {
            SetActive((IWpfTextView)sender);
        }

        private void OnClosed(object sender, EventArgs e)
        {
            var view = (IWpfTextView)sender;
            view.GotAggregateFocus -= OnGotFocus;
            view.Closed -= OnClosed;
            if (!ReferenceEquals(view, currentView)) return;

            if (currentBuffer != null)
            {
                currentBuffer.Changed -= OnBufferChanged;
                currentBuffer = null;
            }
            currentView = null;
            FilePath = "untitled.hs";
            ActiveDocumentChanged?.Invoke(this, EventArgs.Empty);
        }

        private void SetActive(IWpfTextView view)
        {
            if (view == null) return;
            if (ReferenceEquals(view, currentView)) return;

            if (currentBuffer != null)
            {
                currentBuffer.Changed -= OnBufferChanged;
            }

            currentView = view;
            currentBuffer = view.TextBuffer;
            currentBuffer.Changed += OnBufferChanged;
            FilePath = ResolvePath(currentBuffer);
            ActiveDocumentChanged?.Invoke(this, EventArgs.Empty);
        }

        private void OnBufferChanged(object sender, TextContentChangedEventArgs e)
        {
            ContentChanged?.Invoke(this, EventArgs.Empty);
        }

        private static string ResolvePath(ITextBuffer buffer)
        {
            try
            {
                if (buffer.Properties.TryGetProperty(typeof(ITextDocument), out ITextDocument document)
                    && !string.IsNullOrWhiteSpace(document.FilePath))
                {
                    return document.FilePath;
                }
            }
            catch
            {
                // Fall back to a synthetic path for unsaved buffers.
            }
            return "untitled.hs";
        }
    }
}
