"""Start/stop OBS Studio recording via obs-websocket (built into OBS 28+, Tools > obs-websocket
Settings > Enable). Preferred capture backend: gives an exact output path back and can host a
millisecond-timer text source in-scene as a burned-in ground-truth clock (set that source up once
in OBS's UI; this module only starts/stops the recording, it doesn't create scene items).

See ffmpeg_capture.py for a simpler fallback that doesn't require OBS at all.
"""

import argparse
import sys
import time


def connect(host: str = "localhost", port: int = 4455, password: str = ""):
    import obsws_python as obs  # local import: not required unless this backend is used

    return obs.ReqClient(host=host, port=port, password=password, timeout=5)


def start(client) -> None:
    # A prior recording sometimes stays active (OBS occasionally doesn't finalize a StopRecord in
    # time), which makes StartRecord fail with code 500. Clear it first so a run never blocks on a
    # stuck recording.
    try:
        if client.get_record_status().output_active:
            client.stop_record()
            time.sleep(1.5)
    except Exception:
        pass
    client.start_record()


def stop(client, settle_sec: float = 2.0) -> str:
    """Stops recording and returns the path OBS wrote the file to. `settle_sec` gives OBS a moment
    to finalize the file on disk (write the moov atom) before the caller tries to open it for
    analysis -- confirmed the hard way that 0.5s isn't always enough: a real capture attempt left a
    0-byte raw.mp4 in the trial dir (source file existed and had real content in
    C:\\Users\\<user>\\Videos\\, just wasn't finalized yet when orchestrate.py's shutil.copy ran)."""
    resp = client.stop_record()
    time.sleep(settle_sec)
    return resp.output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Manual start/stop of an OBS recording (for testing).")
    parser.add_argument("action", choices=["start", "stop"])
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=4455)
    parser.add_argument("--password", default="")
    args = parser.parse_args()

    client = connect(args.host, args.port, args.password)
    if args.action == "start":
        start(client)
        print("Recording started.")
    else:
        path = stop(client)
        print(f"Recording stopped -> {path}")


if __name__ == "__main__":
    sys.exit(main())
