-- Registers Causa's two data sources in Zetaris (Lightning SQL).
-- Run with:  npm run zetaris:register
-- The script substitutes ${...} from .env, sends each statement to Zetaris'
-- REST API (POST /sql-editor/sqls/run), treats "already exists" as done, and
-- finishes with a federated query that joins the two sources.
-- Both databases run in the causa-db Postgres container (docker-compose.yml),
-- which joins the Zetaris Docker network as causa-db:5432.

-- ERP: region, nation, customer, part, supplier, orders, lineitem
CREATE DATASOURCE ${ZETARIS_ERP_SOURCE} DESCRIBE BY "Causa ERP - orders, customers, parts" OPTIONS (
  jdbcdriver "org.postgresql.Driver",
  jdbcurl "jdbc:postgresql://${CAUSA_DB_HOST}/erp",
  username "causa",
  password "${CAUSA_DB_PASSWORD}"
);
REGISTER DATASOURCE TABLES FROM ${ZETARIS_ERP_SOURCE};

-- CRM: accounts, account_events
CREATE DATASOURCE ${ZETARIS_CRM_SOURCE} DESCRIBE BY "Causa CRM - accounts and account events" OPTIONS (
  jdbcdriver "org.postgresql.Driver",
  jdbcurl "jdbc:postgresql://${CAUSA_DB_HOST}/crm",
  username "causa",
  password "${CAUSA_DB_PASSWORD}"
);
REGISTER DATASOURCE TABLES FROM ${ZETARIS_CRM_SOURCE};
