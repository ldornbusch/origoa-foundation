# Origoa Foundation — build, test and run.
#
#   make build            build web/dist and bin/origoad
#   make test             go vet, gofmt gate, unit tests (PostgreSQL-backed tests need ORIGOA_TEST_DSN)
#   make test-ui          Playwright browser tests against a temporary server (needs ORIGOA_TEST_DSN)
#   make e2e              REST end-to-end script against a temporary server (needs ORIGOA_TEST_DSN)
#   make run              serve http://127.0.0.1:8080 (needs ORIGOA_DB)
.PHONY: build web test test-ui e2e fuzz run clean

ORIGOA_TEST_DSN ?= postgres://postgres:postgres@127.0.0.1:5432/origoa_test?sslmode=disable
# Servers started by e2e/test-ui use their own database: two servers with different
# repositories must never share one projection database.
ORIGOA_E2E_DSN ?= postgres://postgres:postgres@127.0.0.1:5432/origoa_e2e?sslmode=disable
ORIGOA_DB ?= postgres://postgres:postgres@127.0.0.1:5432/origoa?sslmode=disable
export ORIGOA_TEST_DSN

build: web
	go build -o bin/origoad ./cmd/origoad

web:
	cd web && npm install --no-audit --no-fund && npm run typecheck && npm run build

test:
	go vet ./...
	test -z "$$(gofmt -l .)"
	go test -race ./...

fuzz:
	go test -run xxx -fuzz FuzzRoundTrip   -fuzztime 20s ./internal/ojson/
	go test -run xxx -fuzz FuzzCleanFolder -fuzztime 20s ./internal/model/
	go test -run xxx -fuzz FuzzClassify    -fuzztime 20s ./internal/scanner/

# Starts a throwaway server (fresh bare repo, the test database), runs the
# given command against it, and stops it again.
define with_server
	rm -rf /tmp/origoa-$(1).git; \
	./bin/origoad -repo /tmp/origoa-$(1).git -addr 127.0.0.1:$(2) -web web/dist -db "$(ORIGOA_E2E_DSN)" > /tmp/origoa-$(1).log 2>&1 & pid=$$!; \
	for i in $$(seq 1 50); do curl -sf http://127.0.0.1:$(2)/api/repository >/dev/null && break; sleep 0.2; done; \
	$(3); status=$$?; \
	kill $$pid 2>/dev/null; rm -rf /tmp/origoa-$(1).git; exit $$status
endef

e2e: build
	$(call with_server,e2e,18099,./scripts/e2e.sh http://127.0.0.1:18099)

test-ui: build
	$(call with_server,ui,18090,cd web && ORIGOA_URL=http://127.0.0.1:18090 npx playwright test tests/ui.spec.ts)

run: build
	./bin/origoad -repo data/origoa.git -addr 127.0.0.1:8080 -web web/dist -db "$(ORIGOA_DB)"

clean:
	rm -rf bin web/dist web/node_modules web/test-results web/playwright-report
