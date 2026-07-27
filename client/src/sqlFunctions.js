// Funzioni e package built-in di Oracle proposti dall'autocomplete.
// Ogni voce è la firma: il nome è ciò che precede la parentesi, il resto
// finisce nella colonna di dettaglio del popup. Le voci senza parentesi
// (SYSDATE, USER, …) vengono inserite così come sono.

const LIST = `
ABS(n)
ACOS(n)
ADD_MONTHS(data, mesi)
ASCII(carattere)
ASCIISTR(stringa)
ASIN(n)
ATAN(n)
ATAN2(n1, n2)
AVG(expr)
BITAND(n1, n2)
CARDINALITY(nested_table)
CAST(expr AS tipo)
CEIL(n)
CHR(n)
COALESCE(expr, expr, …)
CONCAT(str1, str2)
CORR(expr1, expr2)
COS(n)
COUNT(expr)
COUNT(*)
COVAR_POP(expr1, expr2)
CUME_DIST()
CURRENT_DATE
CURRENT_TIMESTAMP
DBTIMEZONE
DECODE(expr, cerca, risultato, …, default)
DENSE_RANK()
DUMP(expr)
EMPTY_BLOB()
EMPTY_CLOB()
EXP(n)
EXTRACT(campo FROM data)
FIRST_VALUE(expr)
FLOOR(n)
GREATEST(expr, expr, …)
GROUPING(expr)
GROUP_ID()
HEXTORAW(stringa)
INITCAP(stringa)
INSTR(stringa, sotto, pos, occorrenza)
JSON_ARRAY(expr, …)
JSON_ARRAYAGG(expr)
JSON_OBJECT(chiave VALUE expr)
JSON_OBJECTAGG(chiave VALUE expr)
JSON_QUERY(json, percorso)
JSON_TABLE(json, percorso COLUMNS (…))
JSON_VALUE(json, percorso)
LAG(expr, offset, default)
LAST_DAY(data)
LAST_VALUE(expr)
LEAD(expr, offset, default)
LEAST(expr, expr, …)
LENGTH(stringa)
LENGTHB(stringa)
LISTAGG(expr, separatore) WITHIN GROUP (ORDER BY expr)
LN(n)
LNNVL(condizione)
LOCALTIMESTAMP
LOG(base, n)
LOWER(stringa)
LPAD(stringa, lunghezza, riempimento)
LTRIM(stringa, caratteri)
MAX(expr)
MEDIAN(expr)
MIN(expr)
MOD(n1, n2)
MONTHS_BETWEEN(data1, data2)
NANVL(n1, n2)
NCHR(n)
NEW_TIME(data, da, a)
NEXT_DAY(data, giorno)
NTILE(gruppi)
NULLIF(expr1, expr2)
NUMTODSINTERVAL(n, unità)
NUMTOYMINTERVAL(n, unità)
NVL(expr, sostituto)
NVL2(expr, se_valorizzato, se_null)
ORA_HASH(expr)
PERCENTILE_CONT(percentile) WITHIN GROUP (ORDER BY expr)
PERCENTILE_DISC(percentile) WITHIN GROUP (ORDER BY expr)
PERCENT_RANK()
POWER(n1, n2)
RANK()
RATIO_TO_REPORT(expr)
RAWTOHEX(raw)
REGEXP_COUNT(stringa, pattern)
REGEXP_INSTR(stringa, pattern)
REGEXP_LIKE(stringa, pattern, flag)
REGEXP_REPLACE(stringa, pattern, sostituto)
REGEXP_SUBSTR(stringa, pattern, pos, occorrenza)
REMAINDER(n1, n2)
REPLACE(stringa, cerca, sostituto)
ROUND(n, cifre)
ROW_NUMBER()
RPAD(stringa, lunghezza, riempimento)
RTRIM(stringa, caratteri)
SESSIONTIMEZONE
SIGN(n)
SIN(n)
SOUNDEX(stringa)
SQRT(n)
STATS_MODE(expr)
STDDEV(expr)
SUBSTR(stringa, pos, lunghezza)
SUM(expr)
SYSDATE
SYSTIMESTAMP
SYS_CONTEXT(namespace, parametro)
SYS_GUID()
TAN(n)
TO_BINARY_DOUBLE(expr)
TO_CHAR(expr, formato)
TO_CLOB(expr)
TO_DATE(stringa, formato)
TO_DSINTERVAL(stringa)
TO_LOB(long)
TO_NCHAR(expr)
TO_NUMBER(stringa, formato)
TO_TIMESTAMP(stringa, formato)
TO_TIMESTAMP_TZ(stringa, formato)
TO_YMINTERVAL(stringa)
TRANSLATE(stringa, da, a)
TRIM(caratteri FROM stringa)
TRUNC(expr, formato)
TZ_OFFSET(fuso)
UID
UNISTR(stringa)
UPPER(stringa)
USER
USERENV(parametro)
VARIANCE(expr)
VSIZE(expr)
WIDTH_BUCKET(expr, min, max, gruppi)
XMLAGG(expr)
XMLELEMENT(nome, expr)
`;

// Package built-in usati di frequente da un editor SQL, con i membri più comuni.
export const BUILTIN_PACKAGES = {
  DBMS_OUTPUT: ['PUT_LINE(testo)', 'PUT(testo)', 'NEW_LINE', 'ENABLE(dimensione)', 'DISABLE'],
  DBMS_LOB: ['GETLENGTH(lob)', 'SUBSTR(lob, quantità, offset)', 'INSTR(lob, pattern)', 'APPEND(dest, src)'],
  DBMS_RANDOM: ['VALUE(min, max)', 'STRING(opzione, lunghezza)', 'SEED(seme)'],
  DBMS_UTILITY: ['FORMAT_ERROR_BACKTRACE', 'FORMAT_ERROR_STACK', 'GET_TIME', 'DB_VERSION(versione, compatibilità)'],
  DBMS_METADATA: ['GET_DDL(tipo, nome, schema)', 'GET_DEPENDENT_DDL(tipo, nome, schema)'],
  DBMS_XPLAN: ['DISPLAY', 'DISPLAY_CURSOR(sql_id, child, formato)'],
  DBMS_STATS: ['GATHER_TABLE_STATS(schema, tabella)', 'GATHER_SCHEMA_STATS(schema)'],
  DBMS_SESSION: ['SET_IDENTIFIER(id)', 'CLEAR_IDENTIFIER', 'SLEEP(secondi)'],
  DBMS_APPLICATION_INFO: ['SET_MODULE(modulo, azione)', 'SET_CLIENT_INFO(info)'],
  DBMS_SQL: ['OPEN_CURSOR', 'PARSE(cursore, sql, modo)', 'EXECUTE(cursore)', 'CLOSE_CURSOR(cursore)'],
  UTL_FILE: ['FOPEN(percorso, file, modo)', 'PUT_LINE(file, testo)', 'FCLOSE(file)'],
  DBMS_SCHEDULER: ['CREATE_JOB(nome, tipo, azione)', 'RUN_JOB(nome)', 'DROP_JOB(nome)'],
};

// Pseudo-colonne (SYSDATE e simili sono già nell'elenco delle funzioni).
export const PSEUDO_COLUMNS = ['ROWNUM', 'ROWID', 'LEVEL'];

// [{ name, sig, args }] — args = true se la firma ha parametri (il cursore
// viene lasciato dentro le parentesi).
export const FUNCTIONS = LIST.trim()
  .split('\n')
  .map((line) => {
    const open = line.indexOf('(');
    if (open < 0) return { name: line, sig: line, args: false, paren: false };
    return {
      name: line.slice(0, open),
      sig: line,
      args: !/^\(\s*\)/.test(line.slice(open)),
      paren: true,
    };
  });
