using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;

namespace HSharp.VisualStudio.Bridge
{
    /// <summary>
    /// One persistent `hs bridge` process shared by diagnostics and preview.
    /// Requests and responses are line-delimited JSON.
    /// </summary>
    public sealed class BridgeClient : IDisposable
    {
        private static readonly Lazy<BridgeClient> LazyShared =
            new Lazy<BridgeClient>(() => new BridgeClient(), LazyThreadSafetyMode.ExecutionAndPublication);

        public static BridgeClient Shared => LazyShared.Value;

        private readonly object gate = new object();
        private readonly Dictionary<long, TaskCompletionSource<AnalyzeResponse>> pending =
            new Dictionary<long, TaskCompletionSource<AnalyzeResponse>>();

        private Process process;
        private StreamWriter input;
        private long nextId;
        private bool disposed;

        public bool IsRunning
        {
            get
            {
                lock (gate)
                {
                    return process != null && !process.HasExited;
                }
            }
        }

        public async Task<AnalyzeResponse> AnalyzeAsync(
            string text,
            string file,
            string profilePath,
            string entry,
            string[] targets,
            CancellationToken cancellationToken)
        {
            var id = Interlocked.Increment(ref nextId);
            var request = new
            {
                id,
                command = "analyze",
                text,
                file,
                profilePath = string.IsNullOrWhiteSpace(profilePath) ? null : profilePath,
                entry = string.IsNullOrWhiteSpace(entry) ? null : entry,
                targets,
            };

            var response = await SendAsync(request, id, cancellationToken).ConfigureAwait(false);
            if (!string.IsNullOrEmpty(response.Error))
            {
                throw new InvalidOperationException(response.Error);
            }
            return response;
        }

        public void Restart()
        {
            Process old;
            lock (gate)
            {
                old = process;
                process = null;
                input = null;
                FailPendingLocked(new InvalidOperationException("h# bridge was restarted"));
            }

            if (old != null)
            {
                try
                {
                    if (!old.HasExited)
                    {
                        old.Kill();
                    }
                }
                catch
                {
                    // Ignore shutdown races.
                }
                old.Dispose();
            }
        }

        private async Task<AnalyzeResponse> SendAsync(object request, long id, CancellationToken cancellationToken)
        {
            var json = JsonConvert.SerializeObject(request, new JsonSerializerSettings
            {
                NullValueHandling = NullValueHandling.Ignore,
            });

            var completion = new TaskCompletionSource<AnalyzeResponse>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            try
            {
                await Task.Run(() =>
                {
                    lock (gate)
                    {
                        EnsureStartedLocked();
                        pending[id] = completion;
                        // The bridge serializes requests, so writes are tiny and
                        // intentionally synchronous under this lock.
#pragma warning disable VSTHRD103
                        input.WriteLine(json);
                        input.Flush();
#pragma warning restore VSTHRD103
                    }
                }).ConfigureAwait(false);
            }
            catch
            {
                lock (gate)
                {
                    pending.Remove(id);
                }
                throw;
            }

            var delay = Task.Delay(TimeSpan.FromSeconds(8), cancellationToken);
            var winner = await Task.WhenAny(completion.Task, delay).ConfigureAwait(false);
            if (winner != completion.Task)
            {
                lock (gate)
                {
                    pending.Remove(id);
                }
                cancellationToken.ThrowIfCancellationRequested();
                throw new TimeoutException("h# bridge did not answer within 8 seconds");
            }

            return await completion.Task.ConfigureAwait(false);
        }

        private void EnsureStartedLocked()
        {
            if (disposed) throw new ObjectDisposedException(nameof(BridgeClient));
            if (process != null)
            {
                if (!process.HasExited) return;
                process.Dispose();
                process = null;
                input = null;
            }

            HSharpSettings.Load();
            var command = HSharpSettings.Command;
            var arguments = HSharpSettings.Arguments;

            var startInfo = new ProcessStartInfo
            {
                FileName = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe",
                Arguments = "/d /s /c \"" + "\"" + command + "\" " + arguments + "\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = new UTF8Encoding(false),
                StandardErrorEncoding = new UTF8Encoding(false),
            };

            if (!string.IsNullOrWhiteSpace(HSharpSettings.WorkingDirectory)
                && Directory.Exists(HSharpSettings.WorkingDirectory))
            {
                startInfo.WorkingDirectory = HSharpSettings.WorkingDirectory;
            }

            var started = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            started.Start();
            process = started;
            input = new StreamWriter(started.StandardInput.BaseStream, new UTF8Encoding(false))
            {
                AutoFlush = true,
            };

            var reader = started.StandardOutput;
            var errorReader = started.StandardError;
            var captured = started;

            _ = Task.Run(async () => await ReadLoopAsync(captured, reader));
            _ = Task.Run(async () => await DrainErrorsAsync(captured, errorReader));
            _ = Task.Run(async () =>
            {
                await Task.Delay(50).ConfigureAwait(false);
                try
                {
                    await Task.Run(() => captured.WaitForExit()).ConfigureAwait(false);
                }
                catch
                {
                    return;
                }

                lock (gate)
                {
                    if (ReferenceEquals(process, captured))
                    {
                        process = null;
                        input = null;
                        FailPendingLocked(new InvalidOperationException(
                            "h# bridge exited. Check Tools > Options > h# command and arguments."));
                    }
                }
            });
        }

        private async Task ReadLoopAsync(Process source, StreamReader reader)
        {
            try
            {
                string line;
                while ((line = await reader.ReadLineAsync().ConfigureAwait(false)) != null)
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    AnalyzeResponse response;
                    try
                    {
                        response = JsonConvert.DeserializeObject<AnalyzeResponse>(line);
                    }
                    catch
                    {
                        continue;
                    }

                    if (response == null) continue;
                    TaskCompletionSource<AnalyzeResponse> completion;
                    lock (gate)
                    {
                        if (!pending.TryGetValue(response.Id, out completion)) continue;
                        pending.Remove(response.Id);
                    }
                    completion.TrySetResult(response);
                }
            }
            catch
            {
                // Process teardown is handled by the exit watcher.
            }
        }

        private static async Task DrainErrorsAsync(Process source, StreamReader reader)
        {
            try
            {
                while (await reader.ReadLineAsync().ConfigureAwait(false) != null)
                {
                    // Keep stderr drained so the bridge cannot block on a full pipe.
                }
            }
            catch
            {
                // Ignore teardown races.
            }
        }

        private void FailPendingLocked(Exception exception)
        {
            foreach (var completion in pending.Values)
            {
                completion.TrySetException(exception);
            }
            pending.Clear();
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            try
            {
                lock (gate)
                {
                    if (process != null && !process.HasExited && input != null)
                    {
                        input.WriteLine("{\"id\":\"shutdown\",\"command\":\"shutdown\"}");
                        input.Flush();
                    }
                }
                if (process != null && !process.WaitForExit(500))
                {
                    process.Kill();
                }
            }
            catch
            {
                // Best-effort shutdown.
            }
        }
    }
}
