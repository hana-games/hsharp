using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using Microsoft.VisualStudio.Text;
using Microsoft.VisualStudio.Text.Classification;
using Microsoft.VisualStudio.Language.StandardClassification;

namespace HSharp.VisualStudio.Editor
{
    internal sealed class HSharpClassifier : IClassifier
    {
        private readonly IClassificationType keyword;
        private readonly IClassificationType comment;
        private readonly IClassificationType number;
        private readonly ITextBuffer buffer;

        public HSharpClassifier(IClassificationTypeRegistryService registry, ITextBuffer buffer)
        {
            this.buffer = buffer;
            keyword = registry.GetClassificationType(PredefinedClassificationTypeNames.Keyword);
            comment = registry.GetClassificationType(PredefinedClassificationTypeNames.Comment);
            number = registry.GetClassificationType(PredefinedClassificationTypeNames.Number);
            HSharpSettings.Changed += OnSettingsChanged;
        }

        public event EventHandler<ClassificationChangedEventArgs> ClassificationChanged;

        private void OnSettingsChanged(object sender, EventArgs e)
        {
            var snapshot = buffer.CurrentSnapshot;
            ClassificationChanged?.Invoke(
                this,
                new ClassificationChangedEventArgs(new SnapshotSpan(snapshot, 0, snapshot.Length)));
        }

        public IList<ClassificationSpan> GetClassificationSpans(SnapshotSpan span)
        {
            var result = new List<ClassificationSpan>();
            if (span.IsEmpty || span.Snapshot == null) return result;

            var snapshot = span.Snapshot;
            var firstLine = snapshot.GetLineFromPosition(span.Start.Position);
            var lastPosition = Math.Max(span.Start.Position, span.End.Position - 1);
            var lastLine = snapshot.GetLineFromPosition(Math.Min(lastPosition, snapshot.Length));
            var start = firstLine.Start.Position;
            var text = snapshot.GetText(start, lastLine.End.Position - start);
            var keywords = HSharpKeywords.Get();

            var i = 0;
            while (i < text.Length)
            {
                var current = text[i];

                if (current == '/' && i + 1 < text.Length && text[i + 1] == '/')
                {
                    Add(result, snapshot, start + i, text.Length - i, comment);
                    break;
                }

                if (IsIdentifierStart(current))
                {
                    var wordStart = i;
                    i++;
                    while (i < text.Length && IsIdentifierPart(text[i])) i++;
                    var word = text.Substring(wordStart, i - wordStart);
                    if (keywords.Contains(word))
                    {
                        Add(result, snapshot, start + wordStart, word.Length, keyword);
                    }
                    continue;
                }

                if (current >= '0' && current <= '9')
                {
                    var numberStart = i;
                    i++;
                    while (i < text.Length && text[i] >= '0' && text[i] <= '9') i++;
                    Add(result, snapshot, start + numberStart, i - numberStart, number);
                    continue;
                }

                i++;
            }

            return result;
        }

        private static void Add(
            List<ClassificationSpan> result,
            ITextSnapshot snapshot,
            int start,
            int length,
            IClassificationType type)
        {
            if (length <= 0 || start < 0 || start + length > snapshot.Length) return;
            result.Add(new ClassificationSpan(new SnapshotSpan(snapshot, start, length), type));
        }

        private static bool IsIdentifierStart(char value)
        {
            return (value >= 'A' && value <= 'Z')
                || (value >= 'a' && value <= 'z')
                || value == '_';
        }

        private static bool IsIdentifierPart(char value)
        {
            return IsIdentifierStart(value) || (value >= '0' && value <= '9');
        }
    }

    internal static class HSharpKeywords
    {
        private static readonly string[] Roles = { "fn", "let", "if", "else", "return", "true", "false" };
        private static readonly Regex RolePattern = new Regex(
            "\"(?<role>fn|let|if|else|return|true|false)\"\\s*:\\s*\"(?<word>[^\"]+)\"",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);

        private static readonly HashSet<string> Canonical = new HashSet<string>(StringComparer.Ordinal)
        {
            "fn", "let", "if", "else", "return", "true", "false", "i32", "bool",
        };

        private static readonly object Gate = new object();
        private static HashSet<string> cached = Canonical;
        private static string cachedPath = string.Empty;
        private static DateTime cachedWrite = DateTime.MinValue;

        public static HashSet<string> Get()
        {
            var path = HSharpSettings.ProfilePath;
            if (string.IsNullOrWhiteSpace(path)) return Canonical;

            lock (Gate)
            {
                try
                {
                    if (!File.Exists(path)) return Canonical;
                    var write = File.GetLastWriteTimeUtc(path);
                    if (string.Equals(path, cachedPath, StringComparison.OrdinalIgnoreCase)
                        && write == cachedWrite)
                    {
                        return cached;
                    }

                    var text = File.ReadAllText(path);
                    var words = new HashSet<string>(Canonical, StringComparer.Ordinal);
                    var found = new HashSet<string>(StringComparer.Ordinal);
                    foreach (Match match in RolePattern.Matches(text))
                    {
                        found.Add(match.Groups["role"].Value);
                        words.Add(match.Groups["word"].Value);
                    }

                    if (found.Count == Roles.Length)
                    {
                        cached = words;
                        cachedPath = path;
                        cachedWrite = write;
                    }
                    else
                    {
                        cached = Canonical;
                    }
                    return cached;
                }
                catch
                {
                    return Canonical;
                }
            }
        }
    }
}
