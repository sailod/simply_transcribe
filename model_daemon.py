"""Persistent Whisper model daemon — load once, transcribe many times.

Communicates via a local TCP socket.  Each client sends an audio file path
and receives a JSON result.  The model stays hot between invocations.

Usage:
    python model_daemon.py --model-dir models/whisper-large-v3 --device GPU
"""

import argparse
import json
import os
import signal
import socket
import sys
import time
import traceback


def main():
    parser = argparse.ArgumentParser(
        description="Persistent Whisper model daemon (TCP)"
    )
    parser.add_argument(
        "--model-dir",
        default="models/whisper-large-v3",
        help="Path to OpenVINO model directory",
    )
    parser.add_argument(
        "--device",
        default="GPU",
        choices=["CPU", "GPU", "AUTO"],
        help="Inference device",
    )
    parser.add_argument(
        "--port-file",
        default=None,
        help="File to write the listening port number to",
    )
    args = parser.parse_args()

    # Import heavy deps only after argument parsing (so --help is fast)
    try:
        import openvino_genai
    except ImportError:
        print("ERROR: openvino_genai not installed", file=sys.stderr)
        sys.exit(1)

    try:
        import librosa
    except ImportError:
        print("ERROR: librosa not installed", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.model_dir):
        print(f"ERROR: Model directory not found: {args.model_dir}", file=sys.stderr)
        sys.exit(1)

    model_id = os.path.basename(os.path.realpath(args.model_dir).rstrip("/"))
    port_file = args.port_file or f"/tmp/simply-transcribe-{model_id}.port"
    pid_file = f"/tmp/simply-transcribe-{model_id}.pid"
    log_file = f"/tmp/simply-transcribe-{model_id}.log"

    def log(msg):
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{ts}] {msg}", file=sys.stderr, flush=True)

    # Prevent duplicate daemons for the same model
    if os.path.exists(pid_file):
        try:
            with open(pid_file) as f:
                existing_pid = int(f.read().strip())
            os.kill(existing_pid, 0)
            log(f"Daemon already running with PID {existing_pid}")
            sys.exit(0)
        except (OSError, ValueError):
            os.remove(pid_file)  # stale pid file

    # Write our PID
    with open(pid_file, "w") as f:
        f.write(str(os.getpid()))

    log(f"Loading model from {args.model_dir} on {args.device}...")
    pipeline = openvino_genai.WhisperPipeline(args.model_dir, device=args.device)
    log("Model loaded.")

    # Bind to a random available port on localhost only
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", 0))
    sock.listen(5)
    port = sock.getsockname()[1]

    with open(port_file, "w") as f:
        f.write(str(port))

    # Signal readiness
    print(f"READY:{port}", flush=True)

    def handle_signal(signum, frame):
        sock.close()
        for f in (port_file, pid_file):
            if os.path.exists(f):
                os.remove(f)
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    request_num = 0

    while True:
        try:
            conn, _addr = sock.accept()
        except OSError:
            break

        request_num += 1
        t_start = time.time()

        try:
            data = conn.recv(8192).decode("utf-8").strip()
            if not data:
                conn.close()
                continue

            audio_path = data.split("\n")[0]

            if not os.path.exists(audio_path):
                conn.sendall(
                    json.dumps({"error": f"Audio file not found: {audio_path}"}).encode()
                )
                conn.close()
                continue

            audio, sr = librosa.load(audio_path, sr=16000, mono=True)
            dur = len(audio) / sr
            log(f"request #{request_num} | {audio_path} | {dur:.0f}s | generating...")

            result = pipeline.generate(audio.tolist(), return_timestamps=True)

            response = {"text": str(result).strip()}

            if result.chunks:
                response["chunks"] = [
                    {"start": c.start_ts, "end": c.end_ts, "text": c.text}
                    for c in result.chunks
                ]

            conn.sendall(json.dumps(response).encode())
            log(f"request #{request_num} | done in {time.time() - t_start:.1f}s | {len(response['text'])} chars")

        except Exception as e:
            log(f"request #{request_num} | ERROR: {e}")
            log(traceback.format_exc())
            try:
                conn.sendall(json.dumps({"error": str(e)}).encode())
            except Exception:
                pass

            if "GPU" in str(e) or "OpenCL" in str(e) or "clWaitForEvents" in str(e):
                log("GPU error detected — reloading pipeline...")
                try:
                    pipeline = openvino_genai.WhisperPipeline(args.model_dir, device=args.device)
                    log("Pipeline reloaded successfully.")
                except Exception as reload_err:
                    log(f"Pipeline reload failed: {reload_err}")
                    log(traceback.format_exc())
        finally:
            conn.close()


if __name__ == "__main__":
    main()
