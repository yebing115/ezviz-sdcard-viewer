import struct
import datetime
import csv
import os
import sys

UTC = datetime.timezone.utc
LOG_TS_MIN = 1262304000  # 2010-01-01, used only to reject uninitialized noise.
LOG_TS_MAX = 4102444800  # 2100-01-01
MAX_LOG_DURATION_SECONDS = 366 * 24 * 60 * 60


def ts_to_str(ts):
    if ts == 0:
        return "(recording)"
    return datetime.datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d %H:%M:%S")


def is_plausible_log_record(start_ts, end_ts):
    if not (LOG_TS_MIN <= start_ts <= LOG_TS_MAX):
        return False
    if end_ts == 0:
        return True
    if not (LOG_TS_MIN <= end_ts <= LOG_TS_MAX):
        return False
    if end_ts < start_ts:
        return False
    return (end_ts - start_ts) <= MAX_LOG_DURATION_SECONDS


def parse_log(filepath):
    with open(filepath, "rb") as f:
        data = f.read()

    if len(data) < 0x20:
        raise ValueError(f"File too small: {filepath}")

    records = []
    segments = []
    current_segment = None
    for i in range((len(data) - 0x20) // 8):
        off = 0x20 + i * 8
        st = struct.unpack_from("<I", data, off)[0]
        et = struct.unpack_from("<I", data, off + 4)[0]
        if not is_plausible_log_record(st, et):
            current_segment = None
            continue

        if current_segment is None:
            current_segment = {
                "segment": len(segments),
                "start_slot": i,
                "end_slot": i,
                "count": 0,
            }
            segments.append(current_segment)
        else:
            current_segment["end_slot"] = i

        segment_order = current_segment["count"]
        current_segment["count"] += 1
        dur = (et - st) if et != 0 else None
        records.append({
            "slot": i,
            "segment": current_segment["segment"],
            "segment_order": segment_order,
            "start_ts": st,
            "end_ts": et,
            "duration": dur,
        })
    return records, segments


def export_csv(records, out_path):
    chronological = sorted(records, key=lambda r: r["start_ts"])
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "session_index",
            "slot_index",
            "segment",
            "segment_order",
            "start_time",
            "end_time",
            "duration_seconds",
            "duration_hms",
        ])
        for session_index, r in enumerate(chronological):
            dur_str = ""
            dur_hms = "(in progress)"
            if r["duration"] is not None:
                dur_str = str(r["duration"])
                h, m, s = r["duration"] // 3600, (r["duration"] % 3600) // 60, r["duration"] % 60
                dur_hms = f"{h}:{m:02d}:{s:02d}"
            writer.writerow([
                session_index,
                r["slot"],
                r["segment"],
                r["segment_order"],
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

        records, segments = parse_log(fpath)
        out_path = fpath.replace(".bin", ".csv")
        export_csv(records, out_path)
        print(f"{out_path}: {len(records)} records in {len(segments)} segment(s)")


if __name__ == "__main__":
    sys.exit(main())
