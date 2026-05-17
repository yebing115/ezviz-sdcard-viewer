import struct
import os
import sys

def parse_index(filepath):
    with open(filepath, "rb") as f:
        data = f.read()

    if len(data) < 0x30:
        raise ValueError("Index file too small: " + filepath)

    # Parse header
    file_count = struct.unpack_from("<I", data, 12)[0]
    write_pos = struct.unpack_from("<I", data, 20)[0]

    # Find record area start (search for record index 0)
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
        raise ValueError("Could not find record area in " + filepath)

    # Parse all 32-byte records
    records = []
    for i in range(file_count):
        off = record_start + i * 32
        idx = struct.unpack_from("<I", data, off)[0]
        start_ts = struct.unpack_from("<I", data, off + 8)[0]
        end_ts = struct.unpack_from("<I", data, off + 12)[0]
        records.append((idx, start_ts, end_ts))

    return records, write_pos, file_count


def ts_to_str(ts):
    """Convert Unix timestamp to YYYYMMDD_HHMMSS string."""
    import datetime
    try:
        UTC = datetime.timezone.utc
    except AttributeError:
        UTC = datetime.UTC
    dt = datetime.datetime.fromtimestamp(ts, UTC)
    return dt.strftime("%Y%m%d_%H%M%S")


def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))

    # Find index file
    idx_path = None
    for name in ["index00.bin", "index01.bin"]:
        p = os.path.join(base_dir, name)
        if os.path.exists(p):
            idx_path = p
            break

    if idx_path is None:
        print("Error: index00.bin or index01.bin not found")
        return 1

    print(f"Reading: {idx_path}")
    records, write_pos, file_count = parse_index(idx_path)
    print(f"  File count: {file_count}")
    print(f"  Write position: {write_pos}")

    # Sort chronologically (circular buffer order)
    # Oldest = write_pos, newest = write_pos - 1
    chrono = sorted(records, key=lambda r: (r[0] - write_pos) % file_count)
    print(f"  Chronological range: hiv{chrono[0][0]:05d}.mp4 -> hiv{chrono[-1][0]:05d}.mp4")

    # Rename all MP4 files
    os.chdir(base_dir)
    renamed = 0
    skipped = 0

    for idx, start_ts, end_ts in records:
        old_name = f"hiv{idx:05d}.mp4"
        if not os.path.exists(old_name):
            print(f"  SKIP: {old_name} not found")
            skipped += 1
            continue

        start_str = ts_to_str(start_ts)
        end_str = ts_to_str(end_ts)
        new_name = f"{start_str}-{end_str}_hiv{idx:05d}.mp4"

        os.rename(old_name, new_name)
        renamed += 1
        if renamed % 50 == 0:
            print(f"  {renamed}/{file_count} renamed...")

    print(f"Done! Renamed: {renamed}, Skipped: {skipped}")

    # Show examples
    print("\nExample filenames (chronological order):")
    for idx, start_ts, end_ts in chrono[:3]:
        start_str = ts_to_str(start_ts)
        end_str = ts_to_str(end_ts)
        print(f"  {start_str}-{end_str}_hiv{idx:05d}.mp4")
    print("  ...")
    for idx, start_ts, end_ts in chrono[-2:]:
        start_str = ts_to_str(start_ts)
        end_str = ts_to_str(end_ts)
        print(f"  {start_str}-{end_str}_hiv{idx:05d}.mp4")

    return 0


if __name__ == "__main__":
    sys.exit(main())
