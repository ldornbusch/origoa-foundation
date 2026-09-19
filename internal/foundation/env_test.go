package foundation

import "os"

func envDSN() string { return os.Getenv("ORIGOA_TEST_DSN") }
