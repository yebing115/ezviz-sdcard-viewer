import struct
import datetime
import csv
import os
import sys

UTC = datetime.timezone.utc

def ts_to_str(ts):
    if ts == 0:
        return "(recording)"
    return datetime.datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d %H:%M:%S")


def parse_log(filepath):
    with open(filepath, "rb") as f:
        data = f.read()

    if len(data) < 0x20:
        raise ValueError(f"File too small: {filepath}")

    records = []
    for i in range((len(data) - 0x20) // 8):
        off = 0x20 + i * 8
        st = struct.unpack_from("<I", data, off)[0]
        et = struct.unpack_from("<I", data, off + 4)[0]
        if st == 0:
            break
        dur = (et - st) if et != 0 else None
        records.append({
            "index": i,
            "start_ts": st,
            "end_ts": et,
            "duration": dur,
        })
    return records


def export_csv(records, out_path):
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["session_index", "start_time", "end_time", "duration_seconds", "duration_hms"])
        for r in records:
            dur_str = ""
            dur_hms = "(in progress)"
            if r["duration"] is not None:
                dur_str = str(r["duration"])
                h, m, s = r["duration"] // 3600, (r["duration"] % 3600) // 60, r["duration"] % 60
                dur_hms = f"{h}:{m:02d}:{s:02d}"
            writer.writerow([
                r["index"],
                ts_to_str(r["start_ts"]),
                ts_to_str(r["end_ts"]),
                dur_str,
                dur_hms,
            ])


def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))

    for fname in ["logCurFile.bin", "logMainFile.bin"]:
        fpath = os.path.join(base_dir, fname)
        if not os.path.exists(fpath):
            print(f"Skip: {fname} not found")
            continue

        records = parse_log(fpath)
        out_path = fpath.replace(".bin", ".csv")
        export_csv(records, out_path)
        print(f"{out_path}: {len(records)} records")


if __name__ == "__main__":
    sys.exit(main())
