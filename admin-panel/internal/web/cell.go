package web

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func cell(v any) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case []byte:
		return `\x` + hex.EncodeToString(t)
	case [16]byte:
		return formatUUID(t)
	case bool:
		return strconv.FormatBool(t)
	case int:
		return strconv.FormatInt(int64(t), 10)
	case int16:
		return strconv.FormatInt(int64(t), 10)
	case int32:
		return strconv.FormatInt(int64(t), 10)
	case int64:
		return strconv.FormatInt(t, 10)
	case uint16:
		return strconv.FormatUint(uint64(t), 10)
	case uint32:
		return strconv.FormatUint(uint64(t), 10)
	case uint64:
		return strconv.FormatUint(t, 10)
	case float32:
		return strconv.FormatFloat(float64(t), 'f', -1, 32)
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case time.Time:
		return t.Format(time.RFC3339Nano)
	case pgtype.Numeric:
		if f, err := t.Float64Value(); err == nil && f.Valid {
			return strconv.FormatFloat(f.Float64, 'f', -1, 64)
		}
		if b, err := t.Value(); err == nil && b != nil {
			return fmt.Sprintf("%v", b)
		}
		return ""
	case pgtype.Interval:
		return formatInterval(t)
	case pgtype.Date:
		if t.Valid {
			return t.Time.Format("2006-01-02")
		}
		return ""
	case pgtype.Time:
		if t.Valid {
			d := time.Duration(t.Microseconds) * time.Microsecond
			return formatTimeOfDay(d)
		}
		return ""
	case netip.Prefix:
		return t.String()
	case netip.Addr:
		return t.String()
	case net.HardwareAddr:
		return t.String()
	case map[string]any, []any:
		b, err := json.Marshal(t)
		if err == nil {
			return string(b)
		}
		return fmt.Sprintf("%v", t)
	case fmt.Stringer:
		return t.String()
	}
	return fmt.Sprintf("%v", v)
}

func formatUUID(b [16]byte) string {
	const hexDigits = "0123456789abcdef"
	out := make([]byte, 36)
	pos := 0
	for i, x := range b {
		if i == 4 || i == 6 || i == 8 || i == 10 {
			out[pos] = '-'
			pos++
		}
		out[pos] = hexDigits[x>>4]
		out[pos+1] = hexDigits[x&0x0f]
		pos += 2
	}
	return string(out)
}

func formatInterval(iv pgtype.Interval) string {
	if !iv.Valid {
		return ""
	}
	var parts []string
	if iv.Months != 0 {
		parts = append(parts, fmt.Sprintf("%d months", iv.Months))
	}
	if iv.Days != 0 {
		parts = append(parts, fmt.Sprintf("%d days", iv.Days))
	}
	if iv.Microseconds != 0 {
		parts = append(parts, (time.Duration(iv.Microseconds) * time.Microsecond).String())
	}
	if len(parts) == 0 {
		return "0"
	}
	return strings.Join(parts, " ")
}

func formatTimeOfDay(d time.Duration) string {
	h := int(d / time.Hour)
	d -= time.Duration(h) * time.Hour
	m := int(d / time.Minute)
	d -= time.Duration(m) * time.Minute
	s := int(d / time.Second)
	d -= time.Duration(s) * time.Second
	if d > 0 {
		return fmt.Sprintf("%02d:%02d:%02d.%06d", h, m, s, int(d/time.Microsecond))
	}
	return fmt.Sprintf("%02d:%02d:%02d", h, m, s)
}
