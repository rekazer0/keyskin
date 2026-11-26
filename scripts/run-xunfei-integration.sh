#!/bin/bash

# Xunfei Integration Test Runner
# Executes all xunfei integration tests with summary reporting
#
# Usage:
#   ./scripts/run-xunfei-integration.sh [--verbose]
#
# Options:
#   --verbose     Show detailed test logs

set -e

VERBOSE=false
if [[ "$1" == "--verbose" ]]; then
  VERBOSE=true
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEST_DIR="$PROJECT_ROOT/tests"
SUMMARY_FILE="$TEST_DIR/xunfei-integration-summary.txt"

# Color codes for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
TESTS_PASSED=0
TESTS_FAILED=0
WARNINGS=0
START_TIME=$(date +%s)

# Temp file for capturing output
TEMP_LOG=$(mktemp)
trap "rm -f $TEMP_LOG" EXIT

# ============================================================================
# Check Dependencies
# ============================================================================

echo "Checking dependencies..."
MISSING_DEPS=()

for dep in canvas jimp sharp; do
  if ! npm list "$dep" >/dev/null 2>&1; then
    MISSING_DEPS+=("$dep")
  fi
done

if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
  echo -e "${YELLOW}⚠ Warning: Missing optional dependencies: ${MISSING_DEPS[*]}${NC}"
  echo "   Some tests may be skipped."
  WARNINGS=$((WARNINGS + 1))
fi

# ============================================================================
# Run TypeCheck
# ============================================================================

echo "Running TypeScript type checking..."
if npm run typecheck 2>&1 | tee -a "$TEMP_LOG"; then
  echo -e "${GREEN}✓ TypeScript check passed${NC}"
else
  echo -e "${RED}✗ TypeScript check failed${NC}"
  TESTS_FAILED=$((TESTS_FAILED + 1))
  exit 1
fi

# ============================================================================
# Run xunfei-integration.test.mjs
# ============================================================================

echo ""
echo "Running xunfei-integration tests..."
if [[ "$VERBOSE" == true ]]; then
  if node "$TEST_DIR/xunfei-integration.test.mjs" 2>&1 | tee -a "$TEMP_LOG"; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "${GREEN}✓ xunfei-integration tests passed${NC}"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo -e "${RED}✗ xunfei-integration tests failed${NC}"
  fi
else
  if node "$TEST_DIR/xunfei-integration.test.mjs" >/dev/null 2>&1; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "${GREEN}✓ xunfei-integration tests passed${NC}"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo -e "${RED}✗ xunfei-integration tests failed${NC}"
  fi
fi

# ============================================================================
# Run xunfei-samples.test.mjs
# ============================================================================

echo ""
echo "Running xunfei-samples tests..."
if [[ "$VERBOSE" == true ]]; then
  if node "$TEST_DIR/xunfei-samples.test.mjs" 2>&1 | tee -a "$TEMP_LOG"; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "${GREEN}✓ xunfei-samples tests passed${NC}"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo -e "${RED}✗ xunfei-samples tests failed${NC}"
  fi
else
  if node "$TEST_DIR/xunfei-samples.test.mjs" >/dev/null 2>&1; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "${GREEN}✓ xunfei-samples tests passed${NC}"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo -e "${RED}✗ xunfei-samples tests failed${NC}"
  fi
fi

# ============================================================================
# Calculate Duration
# ============================================================================

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
DURATION_STR="${DURATION}s"
if [ $DURATION -gt 60 ]; then
  DURATION_STR="$((DURATION / 60))m $((DURATION % 60))s"
fi

# ============================================================================
# Output Summary to Terminal
# ============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test Results Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✓ Passed:${NC} $TESTS_PASSED"
echo -e "${RED}✗ Failed:${NC} $TESTS_FAILED"
echo -e "${YELLOW}⚠ Warnings:${NC} $WARNINGS"
echo "Total Time: $DURATION_STR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ============================================================================
# Generate Markdown Summary Report
# ============================================================================

{
  echo "# Xunfei Integration Test Report"
  echo ""
  echo "Generated: $(date -u +'%Y-%m-%d %H:%M:%S UTC')"
  echo ""
  echo "## Summary"
  echo ""
  echo "| Metric | Value |"
  echo "|--------|-------|"
  echo "| Tests Passed | $TESTS_PASSED |"
  echo "| Tests Failed | $TESTS_FAILED |"
  echo "| Warnings | $WARNINGS |"
  echo "| Total Duration | $DURATION_STR |"
  echo ""

  if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
    echo "## Missing Dependencies"
    echo ""
    echo "The following optional dependencies are not installed:"
    echo ""
    for dep in "${MISSING_DEPS[@]}"; do
      echo "- \`$dep\`"
    done
    echo ""
    echo "Some tests may be skipped or degraded without these dependencies."
    echo ""
  fi

  echo "## Test Suites"
  echo ""
  echo "- xunfei-integration.test.mjs"
  echo "- xunfei-samples.test.mjs"
  echo ""

  echo "## Status"
  echo ""
  if [ $TESTS_FAILED -eq 0 ]; then
    echo "✓ All tests passed"
  else
    echo "✗ Some tests failed"
  fi
} > "$SUMMARY_FILE"

echo ""
echo "Summary report saved to: $SUMMARY_FILE"

# ============================================================================
# Exit with appropriate code
# ============================================================================

if [ $TESTS_FAILED -gt 0 ]; then
  exit 1
fi

exit 0
