package browser

type Perms struct {
	writable map[string]bool
}

func NewPerms(writeTables []string) *Perms {
	w := make(map[string]bool, len(writeTables))
	for _, t := range writeTables {
		w[t] = true
	}
	return &Perms{writable: w}
}

func (p *Perms) CanWrite(table string) bool {
	return p.writable[table]
}
