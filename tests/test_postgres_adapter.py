from governance.postgres import _adapt_sql


def test_qmark_conversion_ignores_quoted_literals_and_comments():
    sql = "SELECT '?' FROM items WHERE id=? -- keep ? here"
    assert _adapt_sql(sql) == "SELECT '?' FROM items WHERE id=%s -- keep ? here"


def test_replace_translates_to_upsert_and_quotes_window_identifier():
    sql = "INSERT OR REPLACE INTO signal_counts VALUES(?,?,?,?,?,?,?,?)"
    assert _adapt_sql(sql) == (
        'INSERT INTO signal_counts(day,source,topic,"window",value,n,url,fetched_utc) '
        'VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (day,source,topic,"window") '
        "DO UPDATE SET value=EXCLUDED.value,n=EXCLUDED.n,url=EXCLUDED.url,"
        "fetched_utc=EXCLUDED.fetched_utc"
    )


def test_ignore_translates_to_postgres_conflict_clause():
    sql = "INSERT OR IGNORE INTO analysis_employee_ids(number) VALUES(?)"
    assert _adapt_sql(sql) == (
        "INSERT INTO analysis_employee_ids(number) VALUES(%s) ON CONFLICT DO NOTHING"
    )


def test_json_extract_translates_to_postgres_json_operator():
    sql = "SELECT json_extract(v.snapshot,'$.target_role') FROM plan_versions v"
    assert _adapt_sql(sql) == "SELECT (v.snapshot::jsonb #>> '{target_role}') FROM plan_versions v"
