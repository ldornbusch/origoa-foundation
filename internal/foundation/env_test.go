package foundation

import "os"

func envDSN() string { return os.Getenv("GROUNDSILL_TEST_DSN") }
