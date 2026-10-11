"""Stage 3: real commit rollback and concurrent retries in a disposable local DB.

Run as the local PostgreSQL administrator after seed.sql and both migrations:
  python3 supabase/tests/import_transactions.py YOUR_TEST_DATABASE
Uses psql via local Unix sockets; never pass a production connection URL.
"""

import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor


def query(database, sql, *, expect_success=True):
    result = subprocess.run(
        ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", database],
        input=sql, text=True, capture_output=True, check=False,
    )
    if expect_success and result.returncode:
        raise RuntimeError(result.stderr)
    return result


def main(database):
    if ":" in database or "/" in database or "=" in database:
        raise ValueError("Use a disposable local database name, not a connection string")
    owner = "f0000000-0000-4000-8000-000000000001"
    bad_batch = "f0000000-0000-4000-8000-000000000010"
    batch = "f0000000-0000-4000-8000-000000000020"
    process = "f0000000-0000-4000-8000-000000000021"
    flow = "f0000000-0000-4000-8000-000000000022"
    missing = "f0000000-0000-4000-8000-000000000099"
    query(database, f"INSERT INTO auth.users VALUES ('{owner}');")
    transaction = (
        "BEGIN; SET LOCAL ROLE authenticated; "
        f"SET LOCAL \"request.jwt.claim.sub\" = '{owner}'; "
    )
    rows = [
        {"id": process, "type": "process", "name": "Concurrent process",
         "payload": {"referenceToFlowDataSet": {"refObjectId": flow}}},
        {"id": flow, "type": "flow", "name": "Concurrent flow", "payload": {}},
    ]
    try:
        bad_rows = [
            rows[1],
            {"id": process, "type": "process", "name": "Missing target",
             "payload": {"referenceToFlowDataSet": {"refObjectId": missing}}},
        ]
        failed = query(database, transaction +
            f"SELECT public.import_datasets('{bad_batch}','openlca','bad.zip',"
            f"$rows${json.dumps(bad_rows)}$rows$::jsonb); COMMIT;",
            expect_success=False)
        assert failed.returncode != 0, "Invalid graph unexpectedly committed"
        assert "ERROR:" in failed.stderr and (
            "dataset reference" in failed.stderr.lower()
            or "foreign key constraint" in failed.stderr.lower()
        ), failed.stderr
        # Verify from another connection, after the failed COMMIT disconnected.
        counts = query(database,
            f"SELECT (SELECT count(*) FROM public.import_batches WHERE id = '{bad_batch}'),"
            f"(SELECT count(*) FROM public.datasets WHERE id IN ('{process}','{flow}')),"
            f"(SELECT count(*) FROM public.dataset_references WHERE source_dataset_id = '{process}');")
        assert counts.stdout.strip() == "0|0|0", counts.stdout

        sql = transaction + (
            f"SELECT public.import_datasets('{batch}','openlca','concurrent.zip',"
            f"$rows${json.dumps(rows)}$rows$::jsonb); SELECT pg_sleep(0.1); COMMIT;"
        )
        with ThreadPoolExecutor(max_workers=2) as pool:
            reports = list(pool.map(lambda _: json.loads(query(database, sql).stdout), range(2)))
        assert sum(report.get("idempotent", False) for report in reports) == 1, reports
        original = next(report for report in reports if not report.get("idempotent"))
        retry = next(report for report in reports if report.get("idempotent"))
        assert retry == {**original, "idempotent": True}, reports
        counts = query(database,
            f"SELECT (SELECT count(*) FROM public.import_batches WHERE id = '{batch}'),"
            f"(SELECT count(*) FROM public.datasets WHERE import_batch_id = '{batch}'),"
            f"(SELECT count(*) FROM public.dataset_references WHERE source_dataset_id = '{process}');")
        assert counts.stdout.strip() == "1|2|1", counts.stdout
        print("Stage 3 transaction acceptance passed: commit rollback and concurrent retries.")
    finally:
        query(database,
            f"BEGIN; DELETE FROM public.datasets WHERE id IN ('{process}','{flow}');"
            f"DELETE FROM public.import_batches WHERE id IN ('{batch}','{bad_batch}');"
            f"DELETE FROM auth.users WHERE id = '{owner}'; COMMIT;")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: import_transactions.py DISPOSABLE_LOCAL_DATABASE")
    main(sys.argv[1])
