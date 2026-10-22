using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using HSharp.VisualStudio.Bridge;
using HSharp.VisualStudio.Editor;
using Timer = System.Windows.Forms.Timer;

namespace HSharp.VisualStudio.Preview
{
    internal sealed class PreviewControl : UserControl
    {
        private static readonly string[] Targets = { "csharp", "rust", "go", "java" };
        private static readonly string[] TargetLabels = { "C#", "Rust", "Go", "Java" };

        private readonly ComboBox targetBox;
        private readonly CheckBox autoUpdate;
        private readonly Button refreshButton;
        private readonly Button copyButton;
        private readonly Label statusLabel;
        private readonly TextBox output;
        private readonly Timer timer;

        private AnalyzeResponse lastResponse;
        private CancellationTokenSource refreshCancellation;
        private bool disposed;

        public PreviewControl()
        {
            Dock = DockStyle.Fill;
            BackColor = SystemColors.Window;

            var toolbar = new FlowLayoutPanel
            {
                Dock = DockStyle.Top,
                Height = 30,
                Padding = new Padding(4),
                WrapContents = false,
                AutoSize = false,
            };

            toolbar.Controls.Add(new Label
            {
                Text = "Target",
                AutoSize = true,
                Margin = new Padding(2, 6, 4, 0),
            });

            targetBox = new ComboBox
            {
                DropDownStyle = ComboBoxStyle.DropDownList,
                Width = 90,
                Margin = new Padding(0, 3, 12, 0),
            };
            targetBox.Items.AddRange(TargetLabels);
            targetBox.SelectedIndex = 0;
            targetBox.SelectedIndexChanged += (sender, args) => Render();
            toolbar.Controls.Add(targetBox);

            autoUpdate = new CheckBox
            {
                Text = "Live",
                Checked = true,
                AutoSize = true,
                Margin = new Padding(0, 6, 10, 0),
            };
            autoUpdate.CheckedChanged += (sender, args) => { if (autoUpdate.Checked) Schedule(); };
            toolbar.Controls.Add(autoUpdate);

            refreshButton = new Button
            {
                Text = "Refresh",
                AutoSize = true,
                Margin = new Padding(0, 2, 6, 0),
            };
            refreshButton.Click += (sender, args) => Schedule(immediate: true);
            toolbar.Controls.Add(refreshButton);

            copyButton = new Button
            {
                Text = "Copy",
                AutoSize = true,
                Margin = new Padding(0, 2, 0, 0),
            };
            copyButton.Click += (sender, args) => CopyOutput();
            toolbar.Controls.Add(copyButton);

            statusLabel = new Label
            {
                Dock = DockStyle.Top,
                Height = 22,
                Text = "Open an .hs file to preview generated code.",
                Padding = new Padding(6, 3, 6, 0),
                ForeColor = SystemColors.GrayText,
            };

            output = new TextBox
            {
                Dock = DockStyle.Fill,
                Multiline = true,
                ReadOnly = true,
                WordWrap = false,
                ScrollBars = ScrollBars.Both,
                Font = new Font("Consolas", 9.5f),
                BackColor = SystemColors.Window,
                Text = string.Empty,
            };

            Controls.Add(output);
            Controls.Add(statusLabel);
            Controls.Add(toolbar);

            timer = new Timer();
            timer.Tick += OnTimerTick;

            ActiveDocumentTracker.Instance.ActiveDocumentChanged += OnActiveDocumentChanged;
            ActiveDocumentTracker.Instance.ContentChanged += OnContentChanged;
            HSharpSettings.Changed += OnSettingsChanged;

            UpdateStatusForDocument();
            Schedule();
        }

        private void OnSettingsChanged(object sender, EventArgs e)
        {
            Schedule(immediate: true);
        }

        private void OnActiveDocumentChanged(object sender, EventArgs e)
        {
            UpdateStatusForDocument();
            Schedule();
        }

        private void OnContentChanged(object sender, EventArgs e)
        {
            Schedule();
        }

        private void UpdateStatusForDocument()
        {
            var buffer = ActiveDocumentTracker.Instance.Buffer;
            if (buffer == null)
            {
                statusLabel.Text = "Open an .hs file to preview generated code.";
                output.Text = string.Empty;
                return;
            }

            statusLabel.Text = ActiveDocumentTracker.Instance.FilePath + " — waiting for analysis…";
        }

        private void Schedule(bool immediate = false)
        {
            if (disposed) return;
            if (IsHandleCreated && InvokeRequired)
            {
                BeginInvoke(new Action<bool>(Schedule), immediate);
                return;
            }
            if (!autoUpdate.Checked && !immediate) return;
            timer.Stop();
            timer.Interval = immediate ? 1 : HSharpSettings.DebounceMs;
            timer.Start();
        }

        private void OnTimerTick(object sender, EventArgs e)
        {
            timer.Stop();
            _ = RefreshSafeAsync();
        }

        private async Task RefreshSafeAsync()
        {
            try
            {
                await RefreshAsync();
            }
            catch (Exception cause)
            {
                statusLabel.Text = "h# preview failed: " + cause.Message;
            }
        }

        private async Task RefreshAsync()
        {
            var buffer = ActiveDocumentTracker.Instance.Buffer;
            if (buffer == null)
            {
                UpdateStatusForDocument();
                return;
            }

            var snapshot = buffer.CurrentSnapshot;
            var text = snapshot.GetText();
            var file = ActiveDocumentTracker.Instance.FilePath;

            refreshCancellation?.Cancel();
            refreshCancellation?.Dispose();
            refreshCancellation = new CancellationTokenSource();
            var token = refreshCancellation.Token;

            try
            {
                var response = await BridgeClient.Shared.AnalyzeAsync(
                    text,
                    file,
                    HSharpSettings.ProfilePath,
                    null,
                    Targets,
                    token).ConfigureAwait(true);

                if (token.IsCancellationRequested) return;
                lastResponse = response;
                UpdateStatus(response);
                Render();
            }
            catch (OperationCanceledException)
            {
                // Superseded by a newer edit.
            }
            catch (Exception cause)
            {
                statusLabel.Text = "h# bridge unavailable: " + cause.Message;
                output.Text =
                    "The generated-code preview needs the h# CLI.\r\n\r\n" +
                    "1. Build the compiler: npm run build\r\n" +
                    "2. Install the command: npm link\r\n" +
                    "3. Check Tools > Options > h# > command and arguments.\r\n\r\n" +
                    cause;
            }
        }

        private void UpdateStatus(AnalyzeResponse response)
        {
            var errors = response.Diagnostics.Count(d => (d.Severity ?? "error") == "error");
            var warnings = response.Diagnostics.Count - errors;
            var timing = response.Timings?.TotalMs ?? 0;
            var functions = response.Functions?.Count ?? 0;
            var entry = string.IsNullOrEmpty(response.Entry) ? "no entry" : response.Entry;

            var status = new StringBuilder();
            status.Append("h# ");
            status.Append(response.CompilerVersion ?? "0.1.0");
            status.Append(" · ");
            status.Append(entry);
            status.Append(" · ");
            status.Append(functions);
            status.Append(functions == 1 ? " function" : " functions");
            status.Append(" · ");
            status.Append(timing.ToString("0.00"));
            status.Append(" ms");
            if (errors > 0 || warnings > 0)
            {
                status.Append(" · ");
                status.Append(errors);
                status.Append(" error");
                if (errors != 1) status.Append('s');
                if (warnings > 0)
                {
                    status.Append(", ");
                    status.Append(warnings);
                    status.Append(" warning");
                    if (warnings != 1) status.Append('s');
                }
            }
            else if (!string.IsNullOrEmpty(response.EntryError))
            {
                status.Append(" · ");
                status.Append(response.EntryError);
            }
            statusLabel.Text = status.ToString();
            statusLabel.ForeColor = errors > 0 ? Color.Firebrick : SystemColors.GrayText;
        }

        private void Render()
        {
            if (lastResponse == null)
            {
                output.Text = string.Empty;
                return;
            }

            var text = new StringBuilder();
            foreach (var diagnostic in lastResponse.Diagnostics)
            {
                var location = diagnostic.Span?.Start;
                if (location != null)
                {
                    text.Append(location.Line);
                    text.Append(':');
                    text.Append(location.Column);
                    text.Append(": ");
                }
                text.Append(diagnostic.Severity ?? "error");
                text.Append(' ');
                text.Append(diagnostic.Code);
                text.Append(": ");
                text.AppendLine(diagnostic.Message);
                if (!string.IsNullOrEmpty(diagnostic.Hint))
                {
                    text.AppendLine("  hint: " + diagnostic.Hint);
                }
            }

            if (!string.IsNullOrEmpty(lastResponse.EntryError))
            {
                text.AppendLine("entry: " + lastResponse.EntryError);
            }

            if (text.Length > 0) text.AppendLine();

            var target = Targets[Math.Max(0, targetBox.SelectedIndex)];
            var generated = lastResponse.Generated?.FirstOrDefault(t => t.Target == target);
            if (generated == null)
            {
                if (text.Length == 0)
                {
                    text.AppendLine("No generated code. Resolve diagnostics and select an entry function.");
                }
                output.Text = text.ToString();
                output.SelectionStart = 0;
                output.SelectionLength = 0;
                return;
            }

            foreach (var file in generated.Files)
            {
                text.Append("// ── ");
                text.Append(file.Path);
                text.AppendLine(" ─────────────────────────────────────────");
                text.AppendLine(file.Content);
                text.AppendLine();
            }

            output.Text = text.ToString();
            output.SelectionStart = 0;
            output.SelectionLength = 0;
        }

        private void CopyOutput()
        {
            if (string.IsNullOrEmpty(output.Text)) return;
            try
            {
                Clipboard.SetText(output.Text);
                statusLabel.Text = "Copied generated output to the clipboard.";
            }
            catch
            {
                // Clipboard can be locked by another process.
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && !disposed)
            {
                disposed = true;
                ActiveDocumentTracker.Instance.ActiveDocumentChanged -= OnActiveDocumentChanged;
                ActiveDocumentTracker.Instance.ContentChanged -= OnContentChanged;
                HSharpSettings.Changed -= OnSettingsChanged;
                timer.Stop();
                timer.Dispose();
                refreshCancellation?.Cancel();
                refreshCancellation?.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
