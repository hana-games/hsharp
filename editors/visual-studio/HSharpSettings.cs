using System;
using System.IO;
using Newtonsoft.Json;

namespace HSharp.VisualStudio
{
    /// <summary>
    /// Editor settings persisted outside Visual Studio so MEF taggers can use
    /// them without forcing the package to load at startup.
    /// </summary>
    public static class HSharpSettings
    {
        private const string FolderName = "hsharp";
        private const string FileName = "editor.json";

        public static string Command { get; private set; } = "hs";
        public static string Arguments { get; private set; } = "bridge";
        public static string ProfilePath { get; private set; } = string.Empty;
        public static string WorkingDirectory { get; private set; } = string.Empty;
        public static int DebounceMs { get; private set; } = 150;

        public static string SettingsPath
        {
            get
            {
                var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                return Path.Combine(root, FolderName, FileName);
            }
        }

        /// <summary>Raised after persisted settings change so editors can refresh.</summary>
        public static event EventHandler Changed;

        static HSharpSettings()
        {
            Load();
        }

        public static void Load()
        {
            try
            {
                var path = SettingsPath;
                if (!File.Exists(path)) return;
                var data = JsonConvert.DeserializeObject<SettingsData>(File.ReadAllText(path));
                if (data == null) return;
                if (!string.IsNullOrWhiteSpace(data.Command)) Command = data.Command.Trim();
                if (!string.IsNullOrWhiteSpace(data.Arguments)) Arguments = data.Arguments.Trim();
                ProfilePath = data.ProfilePath ?? string.Empty;
                WorkingDirectory = data.WorkingDirectory ?? string.Empty;
                DebounceMs = ClampDebounce(data.DebounceMs);
            }
            catch
            {
                // Corrupt settings must not break the editor. Defaults remain.
            }
        }

        public static void Update(
            string command,
            string arguments,
            string profilePath,
            string workingDirectory,
            int debounceMs)
        {
            Command = string.IsNullOrWhiteSpace(command) ? "hs" : command.Trim();
            Arguments = string.IsNullOrWhiteSpace(arguments) ? "bridge" : arguments.Trim();
            ProfilePath = profilePath == null ? string.Empty : profilePath.Trim();
            WorkingDirectory = workingDirectory == null ? string.Empty : workingDirectory.Trim();
            DebounceMs = ClampDebounce(debounceMs);
            Save();
            Changed?.Invoke(null, EventArgs.Empty);
        }

        private static void Save()
        {
            try
            {
                var path = SettingsPath;
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                var data = new SettingsData
                {
                    Command = Command,
                    Arguments = Arguments,
                    ProfilePath = ProfilePath,
                    WorkingDirectory = WorkingDirectory,
                    DebounceMs = DebounceMs,
                };
                File.WriteAllText(path, JsonConvert.SerializeObject(data, Formatting.Indented));
            }
            catch
            {
                // Settings persistence is best-effort.
            }
        }

        private static int ClampDebounce(int value)
        {
            if (value < 30) return 30;
            if (value > 2000) return 2000;
            return value;
        }

        private sealed class SettingsData
        {
            public string Command { get; set; }
            public string Arguments { get; set; }
            public string ProfilePath { get; set; }
            public string WorkingDirectory { get; set; }
            public int DebounceMs { get; set; }
        }
    }
}
