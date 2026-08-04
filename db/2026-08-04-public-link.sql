-- Public mail link: permanent, revocable short link per mailbox address.
CREATE TABLE IF NOT EXISTS address_public_link (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address_id INTEGER UNIQUE NOT NULL,
    token TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_address_public_link_token ON address_public_link(token);
