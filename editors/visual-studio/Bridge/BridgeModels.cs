using System.Collections.Generic;
using Newtonsoft.Json;

namespace HSharp.VisualStudio.Bridge
{
    public sealed class BridgePosition
    {
        [JsonProperty("line")]
        public int Line { get; set; }

        [JsonProperty("column")]
        public int Column { get; set; }

        [JsonProperty("offset")]
        public int Offset { get; set; }
    }

    public sealed class BridgeSpan
    {
        [JsonProperty("file")]
        public string File { get; set; }

        [JsonProperty("start")]
        public BridgePosition Start { get; set; }

        [JsonProperty("end")]
        public BridgePosition End { get; set; }
    }

    public sealed class BridgeDiagnostic
    {
        [JsonProperty("code")]
        public string Code { get; set; }

        [JsonProperty("severity")]
        public string Severity { get; set; }

        [JsonProperty("message")]
        public string Message { get; set; }

        [JsonProperty("hint")]
        public string Hint { get; set; }

        [JsonProperty("span")]
        public BridgeSpan Span { get; set; }
    }

    public sealed class BridgeTimings
    {
        [JsonProperty("parseMs")]
        public double ParseMs { get; set; }

        [JsonProperty("checkMs")]
        public double CheckMs { get; set; }

        [JsonProperty("entryMs")]
        public double EntryMs { get; set; }

        [JsonProperty("emitMs")]
        public double EmitMs { get; set; }

        [JsonProperty("totalMs")]
        public double TotalMs { get; set; }
    }

    public sealed class BridgeGeneratedFile
    {
        [JsonProperty("path")]
        public string Path { get; set; }

        [JsonProperty("content")]
        public string Content { get; set; }
    }

    public sealed class BridgeGeneratedTarget
    {
        [JsonProperty("target")]
        public string Target { get; set; }

        [JsonProperty("files")]
        public List<BridgeGeneratedFile> Files { get; set; } = new List<BridgeGeneratedFile>();
    }

    public sealed class AnalyzeResponse
    {
        [JsonProperty("id")]
        public long Id { get; set; }

        [JsonProperty("ok")]
        public bool Ok { get; set; }

        [JsonProperty("command")]
        public string Command { get; set; }

        [JsonProperty("error")]
        public string Error { get; set; }

        [JsonProperty("compilerVersion")]
        public string CompilerVersion { get; set; }

        [JsonProperty("coreVersion")]
        public string CoreVersion { get; set; }

        [JsonProperty("diagnostics")]
        public List<BridgeDiagnostic> Diagnostics { get; set; } = new List<BridgeDiagnostic>();

        [JsonProperty("functions")]
        public List<string> Functions { get; set; } = new List<string>();

        [JsonProperty("entry")]
        public string Entry { get; set; }

        [JsonProperty("entryError")]
        public string EntryError { get; set; }

        [JsonProperty("timings")]
        public BridgeTimings Timings { get; set; }

        [JsonProperty("generated")]
        public List<BridgeGeneratedTarget> Generated { get; set; }
    }
}
