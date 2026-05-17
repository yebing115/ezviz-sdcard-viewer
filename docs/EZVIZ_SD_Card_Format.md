# EZVIZ/Hikvision Camera SD Card File Format

This document is based on reverse analysis of the `index00.bin`, `index01.bin`, `logCurFile.bin`, `logMainFile.bin`, and `hiv*.mp4` samples in the current directory. Fields verified against the samples are stated explicitly. Fields that cannot be explained reliably only record observed values, to avoid treating incidental values as format specifications.

## File List

| File | Sample size | Verified purpose |
|------|-------------|------------------|
| index00.bin | 16,777,216 (0x1000000) | Video file index |
| index01.bin | 16,777,216 (0x1000000) | Mirror copy of index00.bin |
| logCurFile.bin | 16,002,048 | Recent/current log slot file, containing a ring-buffer tail segment and the current segment |
| logMainFile.bin | 32,004,192 | Historical log slot file |
| hivXXXXX.mp4 | 268,435,456 (256 MiB) | Fixed-size video segment; content is an MPEG-PS container |

In the current sample, `index00.bin` and `index01.bin` are byte-for-byte identical.

---

## 1. index00.bin / index01.bin (Index Files)

### 1.1 Header (48 bytes, offset 0x00)

| Offset | Length | Type | Sample value | Description |
|--------|--------|------|--------------|-------------|
| 0x00 | 4 | u32 LE | 0x0004E72E | Magic number |
| 0x04 | 4 | u32 LE | 0 | Reserved |
| 0x08 | 4 | u32 LE | 3 | Version number |
| 0x0C | 4 | u32 LE | 475 | Total number of MP4 files |
| 0x10 | 4 | u32 LE | 136 (0x88) | Block/segment parameter; exact meaning not fully confirmed |
| 0x14 | 4 | u32 LE | 135 | Current write position, i.e. the next write slot in the circular index |
| 0x18 | 4 | u32 LE | 65535 (0xFFFF) | Maximum index marker |
| 0x1C | 20 | - | 0 | Padding up to 0x30 |

### 1.2 Special/Active Record (16 bytes, offset 0x30)

In the sample, this record is:

```
index=135, flag=17,
start=2025-02-07 21:27:28,
end=2025-02-07 22:11:32
```

It is not the time range of the flushed index record for `hiv00135.mp4`; in the index record area, `hiv00135.mp4` is still `2024-10-20 18:43:27 ~ 2024-10-20 19:37:00`. Therefore, this area should be understood as an active/pending write marker and should not be used directly to mark an index record as `live`.

| Offset | Length | Type | Description |
|--------|--------|------|-------------|
| 0x00 | 2 | u16 LE | Write slot / record index |
| 0x02 | 2 | u16 LE | Flag or channel-related field; sample value is 17, not main-stream channel 1 |
| 0x04 | 4 | u32 LE | Active interval start time |
| 0x08 | 4 | u32 LE | Active interval end time |
| 0x0C | 4 | u32 LE | Reserved |

### 1.3 Bitmap Area (starting at offset 0x40)

In the sample, the record area starts at `0x500`, so the bitmap area size is `0x4C0` (1216) bytes. The bitmap area shows a marker pattern in 16-byte groups, for example:

```
0x40: 0000000000000000ffff000000000000
0x50: 00000000000000000000000000000000
0x60: ffff0000000000000000000000000000
```

The `0xFFFF` markers are related to block state, but the exact bit meanings have not been fully confirmed.

### 1.4 Index Record Area (32 bytes per record, starting at 0x500)

There are `file_count` records. Each record maps by `index` to `hiv{index:05d}.mp4`.

| Offset | Length | Type | Description |
|--------|--------|------|-------------|
| 0x00 | 4 | u32 LE | Record index (`0` to `file_count-1`) |
| 0x04 | 2 | u16 LE | Channel number; all sample records are 1 |
| 0x06 | 2 | u16 LE | Recording type / event type |
| 0x08 | 4 | u32 LE | Start time (Unix timestamp) |
| 0x0C | 4 | u32 LE | End time (Unix timestamp) |
| 0x10 | 4 | u32 LE | Reserved; sample value is 0 |
| 0x14 | 4 | u32 LE | Data/block usage indicator; sample values are small integers |
| 0x18 | 8 | - | Padding; all zero in the sample |

### 1.5 Circular Buffer Mechanism

`write_pos` is the next write slot and also the slot containing the oldest recording in the current index. In the sample, `write_pos=135`:

- Oldest index record: `hiv00135.mp4`, `2024-10-20 18:43:27 ~ 2024-10-20 19:37:00`
- Newest index record: `hiv00134.mp4`, `2025-02-07 20:28:10 ~ 2025-02-07 21:27:28`
- Active/pending write marker: slot 135, `2025-02-07 21:27:28 ~ 2025-02-07 22:11:32`

When sorting chronologically from oldest to newest, use:

```
write_pos, write_pos+1, ..., file_count-1, 0, 1, ..., write_pos-1
```

---

## 2. logCurFile.bin / logMainFile.bin (Log Slot Files)

Log records start at offset `0x20`, with 8 bytes per slot. The first 32 bytes of the header exist in both files, but the field meanings are not completely identical. In particular, offsets 0x10 and 0x14 cannot be reliably interpreted as "current record count / maximum record capacity".

### 2.1 Header (32 bytes, offset 0x00)

| Offset | Length | Type | Sample observation |
|--------|--------|------|--------------------|
| 0x00 | 4 | u32 LE | Often a timestamp; in logCur, the latest time `2025-02-07 22:11:34` |
| 0x04 | 4 | u32 LE | Often a boundary time; in logCur, `2024-09-16 09:29:58` |
| 0x08 | 4 | u32 LE | Repeats the latest time in logCur |
| 0x0C | 4 | u32 LE | 1 in logCur; a timestamp in logMain |
| 0x10 | 4 | u32 LE | 108 in logCur, likely the current slot; a timestamp in logMain |
| 0x14 | 4 | u32 LE | 230 in logCur, likely the ring-buffer tail start; a timestamp in logMain |
| 0x18 | 4 | u32 LE | Unconfirmed |
| 0x1C | 4 | u32 LE | Timestamp / boundary marker |

### 2.2 Log Records (8 bytes per slot, starting at offset 0x20)

| Offset | Length | Type | Description |
|--------|--------|------|-------------|
| 0x00 | 4 | u32 LE | Recording start time (Unix timestamp) |
| 0x04 | 4 | u32 LE | Recording end time; 0 means recording is in progress or the end time has not been committed |

Do not simply stop at the first `start_ts == 0` record and assume all following records are zero. In the current sample:

- `logMainFile.bin`: slots 0 to 476 are a valid continuous segment, 477 records in total.
- `logCurFile.bin`: slots 0 to 108 are the current segment, 109 records in total, with slot 108 having an end time of 0.
- `logCurFile.bin`: slots 230 to 248 contain another valid ring-buffer tail segment, 19 records in total.
- `logCurFile.bin`: slot 229 is a boundary marker `(0, 2024-09-16 09:29:58)`, not a normal log record.

Therefore, log parsing should scan all slots, extract plausible timestamp pairs, and group them by continuous slot ranges.

---

## 3. Timestamps

All time fields in the sample are little-endian u32 Unix epoch seconds. This document and the scripts output timestamp strings in UTC by default.

---

## 4. Video Files

- File name: `hivXXXXX.mp4` (5 digits, zero-padded)
- Size: fixed at 268,435,456 bytes (256 MiB)
- File header: starts with MPEG-PS pack header `00 00 01 BA`
- Container: MPEG-PS (`ffprobe` reports `format_name=mpeg`)
- Video codec: H.264/AVC

Although these files use the `.mp4` extension, they are not standard ISO BMFF/MP4 containers.

---

## 5. Current Sample Summary

```
Index:
  Magic:        0x0004E72E
  Version:      3
  File count:   475
  Record start: 0x500
  Write pos:    135

Chronological index range:
  Oldest: hiv00135.mp4  2024-10-20 18:43:27 ~ 2024-10-20 19:37:00
  Newest: hiv00134.mp4  2025-02-07 20:28:10 ~ 2025-02-07 21:27:28

Special/activity marker:
  Slot 135  2025-02-07 21:27:28 ~ 2025-02-07 22:11:32

Logs:
  logMainFile.bin: slots 0-476, 477 records, 2023-06-27 ~ 2024-09-16
  logCurFile.bin:  slots 230-248, 19 records, 2024-09-16 ~ 2024-09-30
  logCurFile.bin:  slots 0-108, 109 records, 2024-10-01 ~ 2025-02-07
```
