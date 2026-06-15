package entities

import (
	"reflect"
	"strings"
)

func structTypeOf(model any) reflect.Type {
	t := reflect.TypeOf(model)
	if t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	return t
}

func findField(t reflect.Type, name string) (reflect.StructField, bool) {
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		if f.Name == name {
			return f, true
		}
		if tag := f.Tag.Get("json"); tag != "" {
			if parts := strings.Split(tag, ","); parts[0] == name {
				return f, true
			}
		}
	}
	return reflect.StructField{}, false
}

func hasField(t reflect.Type, name string) bool {
	_, ok := findField(t, name)
	return ok
}
