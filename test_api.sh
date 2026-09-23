#!/usr/bin/env bash
# Integration API Tests for Dhun Backend [T4-02]

BASE_URL="http://127.0.0.1:3000/api"
PASS=0
FAIL=0

test_endpoint() {
  local method=$1
  local endpoint=$2
  local data=$3
  local expected=$4
  local desc=$5

  if [ -n "$data" ]; then
    response=$(curl -s -w "\n%{http_code}" -X "$method" \
      -H "Content-Type: application/json" -d "$data" "$BASE_URL$endpoint")
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint")
  fi

  status=$(echo "$response" | tail -n1)
  if [ "$status" == "$expected" ]; then
    echo "  [PASS] $desc (HTTP $status)"
    ((PASS++))
  else
    echo "  [FAIL] $desc (Expected $expected, got $status)"
    ((FAIL++))
  fi
}

echo "========================================"
echo "  DHUN API INTEGRATION TEST SUITE"
echo "========================================"

test_endpoint "GET" "/songs" "" "200" "GET /songs returns library"
test_endpoint "GET" "/songs/autocomplete?q=Tujhko" "" "200" "GET /songs/autocomplete [T5-02]"
test_endpoint "GET" "/songs/avl/search?q=Tujhko" "" "200" "GET /songs/avl/search [T5-01]"
test_endpoint "GET" "/songs/1/similar" "" "200" "GET /songs/:id/similar [T5-03]"
test_endpoint "GET" "/songs/99999" "" "404" "GET invalid song ID returns 404"

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ $FAIL -eq 0 ]; then
  exit 0
else
  exit 1
fi
