-- Version B: fa (unchanged), fb (body changed), fc (new). fd removed.
-- Load after version A to test: unchanged, updated, created, deleted.

-- fa (unchanged in B)
CREATE OR REPLACE FUNCTION incr_test.fa(x INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN x + 1;
END;
$$;

-- fb: body changed -> updated entity
CREATE OR REPLACE FUNCTION incr_test.fb(a INTEGER, b INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN a * b;
END;
$$;

-- fc: new function -> created entity
CREATE OR REPLACE FUNCTION incr_test.fc(name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN 'Hello, ' || name;
END;
$$;
