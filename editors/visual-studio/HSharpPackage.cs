using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Shell;
using HSharp.VisualStudio.Bridge;

namespace HSharp.VisualStudio
{
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [InstalledProductRegistration("h#", "Live h# diagnostics, syntax highlighting, and generated-code preview", "0.1.0")]
    [ProvideToolWindow(typeof(Preview.PreviewToolWindow), Style = VsDockStyle.Tabbed)]
    [ProvideOptionPage(typeof(HSharpOptionsPage), "h#", "General", 0, 0, true)]
    [Guid(PackageGuidString)]
    public sealed class HSharpPackage : AsyncPackage
    {
        public const string PackageGuidString = "6f1f0c2e-7a3e-4b1e-9f4c-2a5b8d3e7c11";

        protected override async Task InitializeAsync(
            CancellationToken cancellationToken,
            IProgress<ServiceProgressData> progress)
        {
            await base.InitializeAsync(cancellationToken, progress);
            HSharpSettings.Load();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                BridgeClient.Shared.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    public sealed class HSharpOptionsPage : DialogPage
    {
        [Category("Bridge")]
        [DisplayName("h# command")]
        [Description("Command that starts the h# CLI. Default: hs")]
        public string Command { get; set; } = HSharpSettings.Command;

        [Category("Bridge")]
        [DisplayName("Command arguments")]
        [Description("Arguments passed after the command. Default: bridge")]
        public string Arguments { get; set; } = HSharpSettings.Arguments;

        [Category("Bridge")]
        [DisplayName("Working directory")]
        [Description("Optional working directory for the bridge process.")]
        public string WorkingDirectory { get; set; } = HSharpSettings.WorkingDirectory;

        [Category("Language")]
        [DisplayName("Profile path")]
        [Description("Optional profile JSON used for diagnostics, highlighting, and preview. Empty means standard syntax.")]
        public string ProfilePath { get; set; } = HSharpSettings.ProfilePath;

        [Category("Editor")]
        [DisplayName("Debounce (milliseconds)")]
        [Description("Delay between the last edit and analysis/preview refresh. Range: 30-2000.")]
        public int DebounceMs { get; set; } = HSharpSettings.DebounceMs;

        protected override void OnActivate(CancelEventArgs e)
        {
            base.OnActivate(e);
            HSharpSettings.Load();
            Command = HSharpSettings.Command;
            Arguments = HSharpSettings.Arguments;
            WorkingDirectory = HSharpSettings.WorkingDirectory;
            ProfilePath = HSharpSettings.ProfilePath;
            DebounceMs = HSharpSettings.DebounceMs;
        }

        protected override void OnApply(PageApplyEventArgs e)
        {
            if (e.ApplyBehavior == ApplyKind.Apply)
            {
                HSharpSettings.Update(Command, Arguments, ProfilePath, WorkingDirectory, DebounceMs);
                BridgeClient.Shared.Restart();
            }
            base.OnApply(e);
        }
    }
}
