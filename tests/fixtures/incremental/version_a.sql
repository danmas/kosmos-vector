-- Version A: 3 functions (incr_test.fa, incr_test.fb, incr_test.fd)
-- Used as first load; then replace with version_b to test incremental update.

-- fa (unchanged in B)
CREATE OR REPLACE FUNCTION incr_test.fa(x INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN x + 1;
END;
$$;

-- fb: body will change in version B
CREATE OR REPLACE FUNCTION incr_test.fb(a INTEGER, b INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN a + b;
END;
$$;

-- fd: removed in version B (deleted entity)
CREATE OR REPLACE FUNCTION incr_test.fd()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN 'deprecated';
END;
$$;
