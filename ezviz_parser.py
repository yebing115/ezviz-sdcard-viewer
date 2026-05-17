#!/usr/bin/env python3
"""
EZVIZ/Hikvision IP Camera SD Card Index & Log Parser.

Parses @index00.bin, @index01.bin, logCurFile.bin, and logMainFile.bin
to extract recording timestamps and map them to MP4 video files.

File Format Specification
==========================

## index00.bin / index01.bin (16 MB, mirrored copies)

The index file maps each MP4 video file (hivXXXXX.mp4) to its recording
time window. It uses a circular buffer structure.

### Header (48 bytes at offset 0x00)

| Offset | Size | Type  | Description                    |
|--------|------|-------|--------------------------------|
| 0x00   | 4    | u32   | Magic number (0x0004E72E)      |
| 0x04   | 4    | u32   | Reserved (0)                   |
| 0x08   | 4    | u32   | Version (3)                    |
| 0x0C   | 4    | u32   | Total file count (475)         |
| 0x10   | 4    | u32   | Block size (136 = 0x88)       |
| 0x14   | 4    | u32   | Current write position index   |
| 0x18   | 4    | u32   | Max index (65535 = 0xFFFF)    |
| 0x1C   | 12   | -     | Padding (zeros)                |

### Special Record (16 bytes at offset 0x30)

Contains the currently-being-written recording info.

| Offset | Size | Type  | Description              |
|--------|------|-------|--------------------------|
| 0x00   | 2    | u16   | Record index             |
| 0x02   | 2    | u16   | Channel number           |
| 0x04   | 4    | u32   | Start timestamp (Unix)   |
| 0x08   | 4    | u32   | End timestamp (Unix)     |
| 0x0C   | 4    | u32   | Reserved                 |

### Bitmap / Allocation Table (variable size, ~1216 bytes from 0x40)

A block allocation bitmap. Each 16-byte block contains allocation flags
with 0xFFFF markers at alternating positions indicating used/free blocks.

### Index Records (from bitmap end, 32 bytes each, 475 records)

One record per MP4 file. Records are in a circular buffer:
- Records 0 to (write_pos-1): newest recordings
- Records write_pos to (total-1): oldest recordings

| Offset | Size | Type  | Description                         |
|--------|------|-------|-------------------------------------|
| 0x00   | 4    | u32   | Record index (0..474)               |
| 0x04   | 2    | u16   | Channel (1 = main stream)           |
| 0x06   | 2    | u16   | Record type / event type            |
| 0x08   | 4    | u32   | Start timestamp (Unix epoch)        |
| 0x0C   | 4    | u32   | End timestamp (Unix epoch)          |
| 0x10   | 4    | u32   | Reserved (0)                        |
| 0x14   | 4    | u32   | Block count / data usage indicator  |
| 0x18   | 8    | -     | Padding (zeros)                     |

### Circular Buffer Order

The index_count field in the header indicates the next write position.
- Oldest file: hiv{index_count:05d}.mp4
- Newest file: hiv{index_count-1:05d}.mp4
- Next write: hiv{index_count:05d}.mp4 (will be overwritten)

## logCurFile.bin (16 MB)

Rolling log of recent recording sessions (start/stop events).

### Header (32 bytes at offset 0x00)

| Offset | Size | Type  | Description                  |
|--------|------|-------|------------------------------|
| 0x00   | 4    | u32   | Latest recording timestamp   |
| 0x04   | 4    | u32   | Earliest timestamp in log    |
| 0x08   | 4    | u32   | Latest recording timestamp   |
| 0x0C   | 4    | u32   | Unknown (often 1)            |
| 0x10   | 4    | u32   | Current record count         |
| 0x14   | 4    | u32   | Max record capacity          |
| 0x18   | 4    | u32   | Unknown                      |
| 0x1C   | 4    | u32   | Timestamp marker             |

### Log Records (8 bytes each from offset 0x20)

| Offset | Size | Type  | Description                    |
|--------|------|-------|--------------------------------|
| 0x00   | 4    | u32   | Session start time (Unix)      |
| 0x04   | 4    | u32   | Session end time (Unix)        |

Records are sequential: each record's end time equals the next record's
start time (with small gaps for camera restart/motion detection delay).

## logMainFile.bin (32 MB)

Long-term historical log of all recording sessions. Same format as
logCurFile.bin but larger capacity. Contains the full history of all
recordings since the camera was first set up (or SD card formatted).

### Header

Same 32-byte header structure as logCurFile.bin.

### Log Records

Same 8-byte record structure (start_ts, end_ts).
Records are sequential with minimal gaps.
"""

import struct
import datetime
import sys
import os

# Timezone-aware UTC helper
try:
    UTC = datetime.timezone.utc
except AttributeError:
    UTC = datetime.UTC


def ts_to_dt(ts):
    """Convert Unix timestamp to datetime."""
    if ts == 0:
        return None
    return datetime.datetime.fromtimestamp(ts, UTC)


def ts_to_str(ts):
    """Convert Unix timestamp to readable string."""
    dt = ts_to_dt(ts)
    if dt is None:
        return "N/A"
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def parse_index(data):
    """Parse index00.bin or index01.bin."""
    if len(data) < 0x30:
        raise ValueError("Index file too small")

    # Parse header
    magic = struct.unpack_from("<I", data, 0)[0]
    reserved = struct.unpack_from("<I", data, 4)[0]
    version = struct.unpack_from("<I", data, 8)[0]
    file_count = struct.unpack_from("<I", data, 12)[0]
    block_size = struct.unpack_from("<I", data, 16)[0]
    write_pos = struct.unpack_from("<I", data, 20)[0]
    max_index = struct.unpack_from("<I", data, 24)[0]

    header = {
        "magic": magic,
        "reserved": reserved,
        "version": version,
        "file_count": file_count,
        "block_size": block_size,
        "write_pos": write_pos,
        "max_index": max_index,
    }

    # Parse special record at 0x30
    spec_idx = struct.unpack_from("<H", data, 0x30)[0]
    spec_ch = struct.unpack_from("<H", data, 0x32)[0]
    spec_ts1 = struct.unpack_from("<I", data, 0x34)[0]
    spec_ts2 = struct.unpack_from("<I", data, 0x38)[0]

    special_record = {
        "index": spec_idx,
        "channel": spec_ch,
        "start_ts": spec_ts1,
        "end_ts": spec_ts2,
    }

    # Find start of record area
    record_start = None
    offset = 0x40
    while offset < len(data) - 32:
        b = data[offset : offset + 8]
        if b[4:6] == b"\x01\x00":
            idx = struct.unpack_from("<I", b, 0)[0]
            if idx == 0:
                record_start = offset
                break
        offset += 16

    if record_start is None:
        raise ValueError("Could not find record area start")

    bitmap_size = record_start - 0x40
    bitmap = data[0x40:record_start]

    # Parse index records
    records = []
    for i in range(file_count):
        off = record_start + i * 32
        if off + 32 > len(data):
            break
        idx = struct.unpack_from("<I", data, off)[0]
        ch = struct.unpack_from("<H", data, off + 4)[0]
        rec_type = struct.unpack_from("<H", data, off + 6)[0]
        start_ts = struct.unpack_from("<I", data, off + 8)[0]
        end_ts = struct.unpack_from("<I", data, off + 12)[0]
        val1 = struct.unpack_from("<I", data, off + 16)[0]
        val2 = struct.unpack_from("<I", data, off + 20)[0]

        records.append(
            {
                "index": idx,
                "channel": ch,
                "type": rec_type,
                "start_ts": start_ts,
                "end_ts": end_ts,
                "reserved": val1,
                "block_count": val2,
                "filename": f"hiv{idx:05d}.mp4",
            }
        )

    return {
        "header": header,
        "special_record": special_record,
        "bitmap_size": bitmap_size,
        "records": records,
    }


def parse_log(data):
    """Parse logCurFile.bin or logMainFile.bin."""
    if len(data) < 0x20:
        raise ValueError("Log file too small")

    # Parse header (8 x uint32)
    hdr_fields = struct.unpack_from("<8I", data, 0)
    header = {
        "latest_ts": hdr_fields[0],
        "earliest_ts": hdr_fields[1],
        "latest_ts_dup": hdr_fields[2],
        "val_0x0c": hdr_fields[3],
        "record_count": hdr_fields[4],
        "max_records": hdr_fields[5],
        "val_0x18": hdr_fields[6],
        "timestamp_marker": hdr_fields[7],
    }

    # Parse log records (8 bytes each: start_ts, end_ts)
    MAX_RECORDS = (len(data) - 0x20) // 8
    records = []
    for i in range(MAX_RECORDS):
        off = 0x20 + i * 8
        start_ts = struct.unpack_from("<I", data, off)[0]
        end_ts = struct.unpack_from("<I", data, off + 4)[0]
        if start_ts == 0:
            break
        records.append(
            {
                "index": i,
                "start_ts": start_ts,
                "end_ts": end_ts,
                "duration": end_ts - start_ts,
            }
        )

    return {"header": header, "records": records, "valid_count": len(records)}


def print_index_summary(parsed, title="Index File"):
    """Print a human-readable summary of an index file."""
    hdr = parsed["header"]
    spec = parsed["special_record"]
    records = parsed["records"]
    write_pos = hdr["write_pos"]

    print(f"\n{'='*70}")
    print(f"  {title}")
    print(f"{'='*70}")

    print(f"\n[Header]")
    print(f"  Magic:       0x{hdr['magic']:08X}")
    print(f"  Version:     {hdr['version']}")
    print(f"  File count:  {hdr['file_count']}  (number of MP4 files)")
    print(f"  Block size:  {hdr['block_size']}  (0x{hdr['block_size']:02X})")
    print(f"  Write pos:   {write_pos}  (next file to overwrite = hiv{write_pos:05d}.mp4)")
    print(f"  Max index:   {hdr['max_index']}")
    print(f"  Bitmap:      {parsed['bitmap_size']} bytes")

    print(f"\n[Current Recording (live)]")
    print(f"  File:        hiv{spec['index']:05d}.mp4")
    print(f"  Channel:     {spec['channel']}")
    print(f"  Start:       {ts_to_str(spec['start_ts'])}")
    print(f"  End:         {ts_to_str(spec['end_ts'])}")
    if spec["end_ts"] > spec["start_ts"]:
        dur = spec["end_ts"] - spec["start_ts"]
        print(f"  Duration:    {dur}s = {dur//60}m {dur%60}s")

    # Circular buffer order
    print(f"\n[Circular Buffer Layout]")
    print(f"  Write position: {write_pos}")
    print(f"  Newest file:    hiv{(write_pos - 1) % hdr['file_count']:05d}.mp4")
    print(f"  Oldest file:    hiv{write_pos:05d}.mp4")

    # Chronological summary
    chrono = sorted(records, key=lambda r: (r["index"] - write_pos) % hdr["file_count"])
    newest = chrono[-1]
    oldest = chrono[0]
    print(f"\n[Time Range]")
    print(f"  Oldest:       hiv{oldest['index']:05d}.mp4  {ts_to_str(oldest['start_ts'])}")
    print(f"  Newest:       hiv{newest['index']:05d}.mp4  {ts_to_str(newest['end_ts'])}")


def print_log_summary(parsed, title="Log File"):
    """Print a human-readable summary of a log file."""
    hdr = parsed["header"]
    records = parsed["records"]

    print(f"\n{'='*70}")
    print(f"  {title}")
    print(f"{'='*70}")

    print(f"\n[Header]")
    print(f"  Latest TS:    {ts_to_str(hdr['latest_ts'])}")
    print(f"  Earliest TS:  {ts_to_str(hdr['earliest_ts'])}")
    print(f"  Record count: {hdr['record_count']}")
    print(f"  Max records:  {hdr['max_records']}")

    print(f"\n[Records]")
    print(f"  Valid records:  {parsed['valid_count']}")
    if records:
        print(f"  First session:  {ts_to_str(records[0]['start_ts'])}")
        print(f"  Last session:   {ts_to_str(records[-1]['end_ts'])}")
        total_dur = sum(r["duration"] for r in records)
        print(f"  Total duration: {total_dur}s = {total_dur//3600}h {(total_dur%3600)//60}m")


def list_all_files(parsed):
    """List all MP4 files with their timestamps in both orders."""
    hdr = parsed["header"]
    records = parsed["records"]
    write_pos = hdr["write_pos"]
    file_count = hdr["file_count"]

    print(f"\n{'='*70}")
    print(f"  MP4 File Listing (by filename)")
    print(f"{'='*70}")
    print(f"{'Filename':<16} {'Start Time':<22} {'End Time':<22} {'Duration':>10} {'Ch'}")
    print(f"{'-'*16} {'-'*22} {'-'*22} {'-'*10} {'-'*3}")
    for rec in records:
        dur = rec["end_ts"] - rec["start_ts"]
        print(
            f"  {rec['filename']:<14} {ts_to_str(rec['start_ts']):<22} "
            f"{ts_to_str(rec['end_ts']):<22} {dur:>6}s  {rec['channel']}"
        )

    print(f"\n{'='*70}")
    print(f"  MP4 File Listing (chronological order, oldest first)")
    print(f"{'='*70}")
    print(f"{'Filename':<16} {'Start Time':<22} {'End Time':<22} {'Duration':>10}")
    print(f"{'-'*16} {'-'*22} {'-'*22} {'-'*10}")
    chrono = sorted(records, key=lambda r: (r["index"] - write_pos) % file_count)
    for rec in chrono:
        dur = rec["end_ts"] - rec["start_ts"]
        print(
            f"  {rec['filename']:<14} {ts_to_str(rec['start_ts']):<22} "
            f"{ts_to_str(rec['end_ts']):<22} {dur:>6}s"
        )


def main():
    base_dir = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else "."

    index_paths = [
        os.path.join(base_dir, "index00.bin"),
        os.path.join(base_dir, "index01.bin"),
    ]
    log_paths = [
        os.path.join(base_dir, "logCurFile.bin"),
        os.path.join(base_dir, "logMainFile.bin"),
    ]

    # Check what files exist
    files_found = []
    for p in index_paths + log_paths:
        if os.path.exists(p):
            files_found.append(p)

    # Also check current directory
    if not files_found:
        for f in ["index00.bin", "index01.bin", "logCurFile.bin", "logMainFile.bin"]:
            if os.path.exists(f):
                base_dir = "."
                break

    # Parse index file
    idx_file = None
    for p in [os.path.join(base_dir, "index00.bin"), os.path.join(base_dir, "index01.bin"), "index00.bin", "index01.bin"]:
        if os.path.exists(p):
            idx_file = p
            break

    if idx_file is None:
        print("Error: No index file found (index00.bin or index01.bin)")
        sys.exit(1)

    with open(idx_file, "rb") as f:
        idx_data = f.read()
    idx_parsed = parse_index(idx_data)

    print_index_summary(idx_parsed, os.path.basename(idx_file))

    # Parse log files
    for lf in ["logCurFile.bin", "logMainFile.bin"]:
        lpath = os.path.join(os.path.dirname(idx_file), lf)
        if not os.path.exists(lpath):
            lpath = lf
        if os.path.exists(lpath):
            with open(lpath, "rb") as f:
                log_data = f.read()
            log_parsed = parse_log(log_data)
            print_log_summary(log_parsed, os.path.basename(lpath))

    # List all files
    list_all_files(idx_parsed)

    # Export CSV
    csv_path = os.path.join(os.path.dirname(idx_file), "recordings.csv")
    records = idx_parsed["records"]
    write_pos = idx_parsed["header"]["write_pos"]
    chrono = sorted(records, key=lambda r: (r["index"] - write_pos) % idx_parsed["header"]["file_count"])

    with open(csv_path, "w", encoding="utf-8") as f:
        f.write("filename,start_time,end_time,duration_seconds,channel,type,is_live\n")
        for rec in records:
            is_live = rec["index"] == idx_parsed["special_record"]["index"]
            f.write(
                f"{rec['filename']},{ts_to_str(rec['start_ts'])},{ts_to_str(rec['end_ts'])},"
                f"{rec['end_ts'] - rec['start_ts']},{rec['channel']},{rec['type']},{'yes' if is_live else 'no'}\n"
            )
    print(f"\nCSV exported to: {csv_path}")

    # Export chronological CSV
    csv_chrono = os.path.join(os.path.dirname(idx_file), "recordings_chronological.csv")
    with open(csv_chrono, "w", encoding="utf-8") as f:
        f.write("filename,start_time,end_time,duration_seconds,chronological_order\n")
        for i, rec in enumerate(chrono):
            f.write(
                f"{rec['filename']},{ts_to_str(rec['start_ts'])},{ts_to_str(rec['end_ts'])},"
                f"{rec['end_ts'] - rec['start_ts']},{i}\n"
            )
    print(f"Chronological CSV exported to: {csv_chrono}")


if __name__ == "__main__":
    main()
