-- Generated from v2.17.32 backend/app/models.py
-- Commit 703081fbb87a3976362880c8f707a3e3315b6854; SQLite DDL and synthetic ORM-created records.
-- No customer data. Do not regenerate from current models.
BEGIN TRANSACTION;
CREATE TABLE action_log (
	id INTEGER NOT NULL,
	label VARCHAR,
	entries TEXT,
	at DATETIME,
	user_id INTEGER,
	is_applied BOOLEAN NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE TABLE bank_accounts (
	id INTEGER NOT NULL,
	bank_name VARCHAR NOT NULL,
	holder VARCHAR,
	account_number VARCHAR,
	label VARCHAR,
	currency VARCHAR,
	is_active BOOLEAN NOT NULL,
	note TEXT,
	created_at DATETIME,
	PRIMARY KEY (id)
);
CREATE TABLE bank_deposits (
	id INTEGER NOT NULL,
	account_id INTEGER NOT NULL,
	cash_session_id INTEGER,
	amount FLOAT NOT NULL,
	deposit_date DATETIME,
	method VARCHAR,
	reference VARCHAR,
	slip_number VARCHAR,
	note TEXT,
	attachment VARCHAR,
	status VARCHAR NOT NULL,
	reconciled BOOLEAN NOT NULL,
	statement_ref VARCHAR,
	created_by_id INTEGER,
	decided_by_id INTEGER,
	decided_at DATETIME,
	created_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(account_id) REFERENCES bank_accounts (id),
	FOREIGN KEY(cash_session_id) REFERENCES cash_sessions (id),
	FOREIGN KEY(created_by_id) REFERENCES users (id),
	FOREIGN KEY(decided_by_id) REFERENCES users (id)
);
CREATE TABLE cash_sessions (
	id INTEGER NOT NULL,
	opened_at DATETIME,
	business_day VARCHAR,
	opened_by_id INTEGER,
	opening_balance FLOAT,
	closed_at DATETIME,
	closed_by_id INTEGER,
	closing_balance FLOAT,
	expected_balance FLOAT,
	difference FLOAT,
	note TEXT,
	z_report TEXT,
	PRIMARY KEY (id),
	FOREIGN KEY(opened_by_id) REFERENCES users (id),
	FOREIGN KEY(closed_by_id) REFERENCES users (id)
);
INSERT INTO "cash_sessions" VALUES(1,'2020-01-01 00:00:00.000000','2020-01-01',1,500.0,NULL,NULL,NULL,NULL,NULL,'','');
CREATE TABLE categories (
	id INTEGER NOT NULL,
	name VARCHAR NOT NULL,
	description VARCHAR,
	PRIMARY KEY (id),
	UNIQUE (name)
);
CREATE TABLE change_log (
	id INTEGER NOT NULL,
	entities VARCHAR,
	at DATETIME,
	PRIMARY KEY (id)
);
CREATE TABLE company_settings (
	id INTEGER NOT NULL,
	name VARCHAR NOT NULL,
	slogan VARCHAR,
	logo TEXT,
	address VARCHAR,
	phone VARCHAR,
	email VARCHAR,
	website VARCHAR,
	tax_id VARCHAR,
	phone2 VARCHAR,
	country VARCHAR,
	rccm VARCHAR,
	ncc VARCHAR,
	capital_social VARCHAR,
	regime_fiscal VARCHAR,
	currency VARCHAR,
	vat_rate FLOAT NOT NULL,
	about TEXT,
	city VARCHAR,
	receipt_header TEXT,
	receipt_footer TEXT,
	receipt_format VARCHAR,
	printer_name VARCHAR,
	auto_print_cash BOOLEAN NOT NULL,
	drawer_enabled BOOLEAN NOT NULL,
	drawer_port VARCHAR,
	drawer_code VARCHAR,
	drawer_open_after_sale BOOLEAN NOT NULL,
	expiry_critical_days INTEGER NOT NULL,
	expiry_alert_days INTEGER NOT NULL,
	expiry_watch_days INTEGER NOT NULL,
	printing_config TEXT,
	document_layouts TEXT,
	smtp_host VARCHAR,
	smtp_port INTEGER,
	smtp_user VARCHAR,
	smtp_password VARCHAR,
	smtp_from VARCHAR,
	smtp_tls BOOLEAN NOT NULL,
	backup_dir VARCHAR,
	backup_auto BOOLEAN NOT NULL,
	backup_keep INTEGER NOT NULL,
	backup_on_sale BOOLEAN NOT NULL,
	last_backup_at DATETIME,
	fne_enabled BOOLEAN NOT NULL,
	fne_environment VARCHAR,
	fne_api_url VARCHAR,
	fne_token_url VARCHAR,
	fne_client_id VARCHAR,
	fne_client_secret VARCHAR,
	fne_api_key VARCHAR,
	support_whatsapp VARCHAR,
	support_email VARCHAR,
	updated_at DATETIME,
	PRIMARY KEY (id)
);
INSERT INTO "company_settings" VALUES(1,'Boutique ancienne','','','','','','','','','','','','','','FCFA',0.0,'','','','Merci de votre confiance !','A4','',1,0,'','27,112,0,25,250',1,7,30,60,'','','',587,'','','',1,'',1,30,0,NULL,0,'test','','','','','','0710069059','ankouame022@gmail.com','2026-11-09 09:42:08.121262');
CREATE TABLE counters (
	name VARCHAR NOT NULL,
	value INTEGER NOT NULL,
	PRIMARY KEY (name)
);
CREATE TABLE customers (
	id INTEGER NOT NULL,
	name VARCHAR NOT NULL,
	email VARCHAR,
	phone VARCHAR,
	address VARCHAR,
	credit_limit FLOAT,
	created_at DATETIME,
	PRIMARY KEY (id)
);
CREATE TABLE debt_payments (
	id INTEGER NOT NULL,
	debt_id INTEGER NOT NULL,
	amount FLOAT,
	date DATETIME,
	method VARCHAR,
	note TEXT,
	reference VARCHAR,
	receipt_reference VARCHAR,
	cancelled BOOLEAN,
	cancel_reason TEXT,
	cancelled_at DATETIME,
	cancelled_by_id INTEGER,
	created_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(debt_id) REFERENCES debts (id),
	FOREIGN KEY(cancelled_by_id) REFERENCES users (id),
	FOREIGN KEY(created_by_id) REFERENCES users (id)
);
INSERT INTO "debt_payments" VALUES(1,1,50.0,'2020-01-01 00:00:00.000000','Espèces','','','',0,'',NULL,NULL,1);
CREATE TABLE debts (
	id INTEGER NOT NULL,
	kind VARCHAR,
	party VARCHAR,
	customer_id INTEGER,
	supplier_id INTEGER,
	sale_id INTEGER,
	reference VARCHAR,
	amount FLOAT,
	due_date DATETIME,
	note TEXT,
	created_at DATETIME,
	created_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(customer_id) REFERENCES customers (id),
	FOREIGN KEY(supplier_id) REFERENCES suppliers (id),
	FOREIGN KEY(sale_id) REFERENCES sales (id),
	FOREIGN KEY(created_by_id) REFERENCES users (id)
);
INSERT INTO "debts" VALUES(1,'creance','Client ancien',NULL,NULL,NULL,'',200.0,NULL,'','2020-01-01 00:00:00.000000',1);
CREATE TABLE deliveries (
	id INTEGER NOT NULL,
	reference VARCHAR NOT NULL,
	order_id INTEGER,
	customer_id INTEGER,
	customer_name VARCHAR,
	sale_id INTEGER,
	date DATETIME,
	status VARCHAR,
	validated_at DATETIME,
	address VARCHAR,
	carrier VARCHAR,
	recipient VARCHAR,
	note TEXT,
	created_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(order_id) REFERENCES orders (id),
	FOREIGN KEY(customer_id) REFERENCES customers (id),
	FOREIGN KEY(sale_id) REFERENCES sales (id),
	FOREIGN KEY(created_by_id) REFERENCES users (id)
);
CREATE TABLE delivery_items (
	id INTEGER NOT NULL,
	delivery_id INTEGER NOT NULL,
	product_id INTEGER,
	product_name VARCHAR,
	reference VARCHAR,
	unit VARCHAR,
	ordered_quantity INTEGER,
	previously_delivered INTEGER,
	quantity INTEGER,
	unit_price FLOAT,
	subtotal FLOAT,
	observation VARCHAR,
	PRIMARY KEY (id),
	FOREIGN KEY(delivery_id) REFERENCES deliveries (id),
	FOREIGN KEY(product_id) REFERENCES products (id)
);
CREATE TABLE employees (
	id INTEGER NOT NULL,
	matricule VARCHAR NOT NULL,
	last_name VARCHAR NOT NULL,
	first_name VARCHAR,
	gender VARCHAR,
	birth_date DATETIME,
	phone VARCHAR,
	address VARCHAR,
	job VARCHAR,
	department VARCHAR,
	hired_at DATETIME,
	contract VARCHAR,
	status VARCHAR,
	base_salary FLOAT NOT NULL,
	payment_method VARCHAR,
	bank VARCHAR,
	account_number VARCHAR,
	social_number VARCHAR,
	email VARCHAR,
	note TEXT,
	is_active BOOLEAN NOT NULL,
	created_at DATETIME,
	updated_at DATETIME,
	PRIMARY KEY (id)
);
CREATE TABLE expenses (
	id INTEGER NOT NULL,
	label VARCHAR NOT NULL,
	category VARCHAR,
	amount FLOAT,
	date DATETIME,
	note TEXT,
	created_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(created_by_id) REFERENCES users (id)
);
CREATE TABLE fne_invoices (
	id INTEGER NOT NULL,
	sale_id INTEGER NOT NULL,
	status VARCHAR NOT NULL,
	fne_reference VARCHAR,
	fne_number VARCHAR,
	fne_token VARCHAR,
	request_payload TEXT,
	response_payload TEXT,
	last_error TEXT,
	attempts INTEGER NOT NULL,
	submitted_at DATETIME,
	certified_at DATETIME,
	created_by_id INTEGER,
	created_at DATETIME,
	updated_at DATETIME,
	PRIMARY KEY (id),
	UNIQUE (sale_id),
	FOREIGN KEY(sale_id) REFERENCES sales (id),
	FOREIGN KEY(created_by_id) REFERENCES users (id)
);
CREATE TABLE license_state (
	id INTEGER NOT NULL,
	installation_uid VARCHAR NOT NULL,
	central_url VARCHAR,
	token VARCHAR,
	public_key TEXT,
	license_token TEXT,
	client_name VARCHAR,
	license_key VARCHAR,
	plan_code VARCHAR,
	plan_name VARCHAR,
	status VARCHAR,
	features TEXT,
	starts_at DATETIME,
	ends_at DATETIME,
	grace_days INTEGER,
	offline_days INTEGER,
	last_sync DATETIME,
	last_error VARCHAR,
	directives_state TEXT,
	support TEXT,
	registered_at DATETIME,
	PRIMARY KEY (id)
);
CREATE TABLE mobile_op_applied (
	remote_id VARCHAR NOT NULL,
	applied_at DATETIME,
	PRIMARY KEY (remote_id)
);
CREATE TABLE notifications (
	id INTEGER NOT NULL,
	kind VARCHAR,
	title VARCHAR NOT NULL,
	message TEXT,
	link VARCHAR,
	sale_id INTEGER,
	is_read BOOLEAN NOT NULL,
	read_by TEXT,
	created_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(sale_id) REFERENCES sales (id)
);
CREATE TABLE order_items (
	id INTEGER NOT NULL,
	order_id INTEGER NOT NULL,
	product_id INTEGER,
	product_name VARCHAR,
	reference VARCHAR,
	unit VARCHAR,
	quantity INTEGER,
	delivered_quantity INTEGER NOT NULL,
	unit_price FLOAT,
	discount FLOAT,
	subtotal FLOAT,
	PRIMARY KEY (id),
	FOREIGN KEY(order_id) REFERENCES orders (id),
	FOREIGN KEY(product_id) REFERENCES products (id)
);
CREATE TABLE orders (
	id INTEGER NOT NULL,
	reference VARCHAR NOT NULL,
	customer_id INTEGER,
	customer_name VARCHAR,
	date DATETIME,
	expected_date DATETIME,
	status VARCHAR,
	total FLOAT,
	discount FLOAT,
	deposit FLOAT,
	price_mode VARCHAR,
	delivery_address VARCHAR,
	payment_terms VARCHAR,
	delivery_terms VARCHAR,
	note TEXT,
	created_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(customer_id) REFERENCES customers (id),
	FOREIGN KEY(created_by_id) REFERENCES users (id)
);
CREATE TABLE password_reset_tokens (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	token_hash VARCHAR NOT NULL,
	expires_at DATETIME NOT NULL,
	used_at DATETIME,
	created_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE TABLE payroll_elements (
	id INTEGER NOT NULL,
	name VARCHAR NOT NULL,
	kind VARCHAR,
	mode VARCHAR,
	value FLOAT NOT NULL,
	base VARCHAR,
	ceiling FLOAT NOT NULL,
	automatic BOOLEAN NOT NULL,
	is_active BOOLEAN NOT NULL,
	starts_on DATETIME,
	ends_on DATETIME,
	position INTEGER NOT NULL,
	created_at DATETIME,
	PRIMARY KEY (id)
);
CREATE TABLE payslip_lines (
	id INTEGER NOT NULL,
	payslip_id INTEGER NOT NULL,
	element_id INTEGER,
	kind VARCHAR,
	label VARCHAR,
	quantity FLOAT NOT NULL,
	rate FLOAT NOT NULL,
	base FLOAT NOT NULL,
	amount FLOAT NOT NULL,
	position INTEGER NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(payslip_id) REFERENCES payslips (id),
	FOREIGN KEY(element_id) REFERENCES payroll_elements (id)
);
CREATE TABLE payslips (
	id INTEGER NOT NULL,
	reference VARCHAR NOT NULL,
	employee_id INTEGER NOT NULL,
	year INTEGER NOT NULL,
	month INTEGER NOT NULL,
	base_salary FLOAT NOT NULL,
	gross FLOAT NOT NULL,
	deductions FLOAT NOT NULL,
	net FLOAT NOT NULL,
	status VARCHAR,
	worked_days FLOAT NOT NULL,
	absence_days FLOAT NOT NULL,
	overtime_hours FLOAT NOT NULL,
	overtime_rate FLOAT NOT NULL,
	validated_at DATETIME,
	paid_at DATETIME,
	payment_method VARCHAR,
	cancel_reason TEXT,
	note TEXT,
	created_at DATETIME,
	updated_at DATETIME,
	created_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(employee_id) REFERENCES employees (id),
	FOREIGN KEY(created_by_id) REFERENCES users (id)
);
CREATE TABLE price_history (
	id INTEGER NOT NULL,
	product_id INTEGER NOT NULL,
	field VARCHAR,
	old_value FLOAT,
	new_value FLOAT,
	changed_at DATETIME,
	changed_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(product_id) REFERENCES products (id),
	FOREIGN KEY(changed_by_id) REFERENCES users (id)
);
CREATE TABLE products (
	id INTEGER NOT NULL,
	name VARCHAR NOT NULL,
	sku VARCHAR NOT NULL,
	description TEXT,
	category_id INTEGER,
	supplier_id INTEGER,
	purchase_price FLOAT,
	sale_price FLOAT,
	wholesale_price FLOAT,
	quantity INTEGER,
	min_stock INTEGER,
	qr_code VARCHAR,
	barcode VARCHAR,
	image TEXT,
	created_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(category_id) REFERENCES categories (id),
	FOREIGN KEY(supplier_id) REFERENCES suppliers (id)
);
INSERT INTO "products" VALUES(1,'Article ancien','LEGACY-1','',NULL,NULL,40.0,100.0,0.0,20,5,'','','','2020-01-01 00:00:00.000000');
CREATE TABLE proforma_items (
	id INTEGER NOT NULL,
	proforma_id INTEGER NOT NULL,
	product_id INTEGER,
	product_name VARCHAR,
	reference VARCHAR,
	unit VARCHAR,
	quantity INTEGER,
	unit_price FLOAT,
	discount FLOAT,
	subtotal FLOAT,
	PRIMARY KEY (id),
	FOREIGN KEY(proforma_id) REFERENCES proformas (id),
	FOREIGN KEY(product_id) REFERENCES products (id)
);
CREATE TABLE proformas (
	id INTEGER NOT NULL,
	reference VARCHAR NOT NULL,
	customer_id INTEGER,
	customer_name VARCHAR,
	date DATETIME,
	valid_until DATETIME,
	total FLOAT,
	discount FLOAT,
	note TEXT,
	kind VARCHAR,
	status VARCHAR,
	converted_from_id INTEGER,
	order_id INTEGER,
	created_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(customer_id) REFERENCES customers (id),
	FOREIGN KEY(converted_from_id) REFERENCES proformas (id),
	FOREIGN KEY(order_id) REFERENCES orders (id),
	FOREIGN KEY(created_by_id) REFERENCES users (id)
);
CREATE TABLE purchase_items (
	id INTEGER NOT NULL,
	purchase_id INTEGER NOT NULL,
	product_id INTEGER,
	product_name VARCHAR,
	quantity INTEGER,
	received_quantity INTEGER,
	unit_cost FLOAT,
	subtotal FLOAT,
	PRIMARY KEY (id),
	FOREIGN KEY(purchase_id) REFERENCES purchases (id),
	FOREIGN KEY(product_id) REFERENCES products (id)
);
CREATE TABLE purchases (
	id INTEGER NOT NULL,
	reference VARCHAR NOT NULL,
	supplier_id INTEGER,
	supplier_name VARCHAR,
	date DATETIME,
	expected_date DATETIME,
	received_at DATETIME,
	status VARCHAR,
	total FLOAT,
	paid FLOAT,
	invoice_number VARCHAR,
	note TEXT,
	created_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(supplier_id) REFERENCES suppliers (id),
	FOREIGN KEY(created_by_id) REFERENCES users (id)
);
CREATE TABLE recovery_keys (
	id INTEGER NOT NULL,
	key_hash VARCHAR NOT NULL,
	created_at DATETIME,
	used_at DATETIME,
	created_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(created_by_id) REFERENCES users (id)
);
CREATE TABLE role_permissions (
	id INTEGER NOT NULL,
	role VARCHAR NOT NULL,
	permission VARCHAR NOT NULL,
	allowed BOOLEAN NOT NULL,
	PRIMARY KEY (id)
);
CREATE TABLE sale_items (
	id INTEGER NOT NULL,
	sale_id INTEGER NOT NULL,
	product_id INTEGER,
	product_name VARCHAR,
	quantity INTEGER,
	unit_price FLOAT,
	discount FLOAT,
	subtotal FLOAT,
	PRIMARY KEY (id),
	FOREIGN KEY(sale_id) REFERENCES sales (id),
	FOREIGN KEY(product_id) REFERENCES products (id)
);
CREATE TABLE sale_payments (
	id INTEGER NOT NULL,
	sale_id INTEGER NOT NULL,
	method VARCHAR,
	amount FLOAT,
	PRIMARY KEY (id),
	FOREIGN KEY(sale_id) REFERENCES sales (id)
);
CREATE TABLE sale_return_items (
	id INTEGER NOT NULL,
	return_id INTEGER NOT NULL,
	product_id INTEGER,
	product_name VARCHAR,
	quantity INTEGER,
	unit_price FLOAT,
	subtotal FLOAT,
	PRIMARY KEY (id),
	FOREIGN KEY(return_id) REFERENCES sale_returns (id),
	FOREIGN KEY(product_id) REFERENCES products (id)
);
CREATE TABLE sale_returns (
	id INTEGER NOT NULL,
	reference VARCHAR NOT NULL,
	sale_id INTEGER NOT NULL,
	date DATETIME,
	total FLOAT,
	reason TEXT,
	created_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(sale_id) REFERENCES sales (id),
	FOREIGN KEY(created_by_id) REFERENCES users (id)
);
CREATE TABLE sales (
	id INTEGER NOT NULL,
	reference VARCHAR NOT NULL,
	customer_id INTEGER,
	date DATETIME,
	total FLOAT,
	status VARCHAR,
	payment_method VARCHAR,
	note TEXT,
	receipt_footer TEXT,
	price_mode VARCHAR,
	created_by_id INTEGER,
	cash_session_id INTEGER,
	print_count INTEGER NOT NULL,
	paid_amount FLOAT NOT NULL,
	discount FLOAT NOT NULL,
	is_gift BOOLEAN NOT NULL,
	client_id VARCHAR,
	PRIMARY KEY (id),
	FOREIGN KEY(customer_id) REFERENCES customers (id),
	FOREIGN KEY(created_by_id) REFERENCES users (id),
	FOREIGN KEY(cash_session_id) REFERENCES cash_sessions (id)
);
CREATE TABLE security_log (
	id INTEGER NOT NULL,
	at DATETIME,
	event VARCHAR,
	identifier VARCHAR,
	detail TEXT,
	station VARCHAR,
	success BOOLEAN NOT NULL,
	user_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE TABLE stock_lots (
	id INTEGER NOT NULL,
	product_id INTEGER,
	lot_number VARCHAR,
	expiry_date DATETIME,
	quantity INTEGER,
	created_at DATETIME,
	created_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(product_id) REFERENCES products (id),
	FOREIGN KEY(created_by_id) REFERENCES users (id)
);
CREATE TABLE stock_movements (
	id INTEGER NOT NULL,
	product_id INTEGER,
	product_name VARCHAR,
	kind VARCHAR,
	quantity INTEGER,
	stock_before INTEGER,
	stock_after INTEGER,
	reason VARCHAR,
	date DATETIME,
	created_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(product_id) REFERENCES products (id),
	FOREIGN KEY(created_by_id) REFERENCES users (id)
);
CREATE TABLE stock_transfer_items (
	id INTEGER NOT NULL,
	transfer_id INTEGER,
	product_id INTEGER,
	product_name VARCHAR,
	quantity INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(transfer_id) REFERENCES stock_transfers (id),
	FOREIGN KEY(product_id) REFERENCES products (id)
);
CREATE TABLE stock_transfers (
	id INTEGER NOT NULL,
	reference VARCHAR,
	direction VARCHAR,
	store_name VARCHAR,
	note VARCHAR,
	created_at DATETIME,
	created_by_id INTEGER,
	PRIMARY KEY (id),
	UNIQUE (reference),
	FOREIGN KEY(created_by_id) REFERENCES users (id)
);
CREATE TABLE suppliers (
	id INTEGER NOT NULL,
	name VARCHAR NOT NULL,
	contact VARCHAR,
	email VARCHAR,
	phone VARCHAR,
	address VARCHAR,
	logo TEXT,
	created_at DATETIME,
	PRIMARY KEY (id)
);
CREATE TABLE support_requests (
	id INTEGER NOT NULL,
	name VARCHAR NOT NULL,
	email VARCHAR,
	subject VARCHAR NOT NULL,
	category VARCHAR,
	message TEXT NOT NULL,
	status VARCHAR NOT NULL,
	created_by_id INTEGER,
	created_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(created_by_id) REFERENCES users (id)
);
CREATE TABLE users (
	id INTEGER NOT NULL,
	name VARCHAR NOT NULL,
	email VARCHAR NOT NULL,
	hashed_password VARCHAR NOT NULL,
	role VARCHAR,
	photo TEXT,
	is_active BOOLEAN NOT NULL,
	notification_kinds VARCHAR,
	created_at DATETIME,
	PRIMARY KEY (id)
);
INSERT INTO "users" VALUES(1,'Admin ancien','upgrade@test.invalid','unused','admin','',1,'','2020-01-01 00:00:00.000000');
CREATE UNIQUE INDEX ix_users_email ON users (email);
CREATE INDEX ix_users_id ON users (id);
CREATE INDEX ix_company_settings_id ON company_settings (id);
CREATE INDEX ix_categories_id ON categories (id);
CREATE INDEX ix_suppliers_id ON suppliers (id);
CREATE INDEX ix_customers_id ON customers (id);
CREATE INDEX ix_bank_accounts_id ON bank_accounts (id);
CREATE INDEX ix_change_log_id ON change_log (id);
CREATE INDEX ix_license_state_id ON license_state (id);
CREATE INDEX ix_employees_id ON employees (id);
CREATE UNIQUE INDEX ix_employees_matricule ON employees (matricule);
CREATE INDEX ix_payroll_elements_kind ON payroll_elements (kind);
CREATE INDEX ix_payroll_elements_id ON payroll_elements (id);
CREATE INDEX ix_role_permissions_id ON role_permissions (id);
CREATE INDEX ix_role_permissions_role ON role_permissions (role);
CREATE INDEX ix_role_permissions_permission ON role_permissions (permission);
CREATE UNIQUE INDEX ix_products_sku ON products (sku);
CREATE INDEX ix_products_barcode ON products (barcode);
CREATE INDEX ix_products_id ON products (id);
CREATE INDEX ix_cash_sessions_id ON cash_sessions (id);
CREATE INDEX ix_cash_sessions_business_day ON cash_sessions (business_day);
CREATE INDEX ix_expenses_id ON expenses (id);
CREATE INDEX ix_stock_transfers_id ON stock_transfers (id);
CREATE UNIQUE INDEX ix_password_reset_tokens_token_hash ON password_reset_tokens (token_hash);
CREATE INDEX ix_password_reset_tokens_id ON password_reset_tokens (id);
CREATE INDEX ix_security_log_at ON security_log (at);
CREATE INDEX ix_security_log_id ON security_log (id);
CREATE INDEX ix_security_log_event ON security_log (event);
CREATE INDEX ix_recovery_keys_id ON recovery_keys (id);
CREATE INDEX ix_orders_id ON orders (id);
CREATE UNIQUE INDEX ix_orders_reference ON orders (reference);
CREATE INDEX ix_orders_status ON orders (status);
CREATE INDEX ix_action_log_id ON action_log (id);
CREATE UNIQUE INDEX ix_purchases_reference ON purchases (reference);
CREATE INDEX ix_purchases_id ON purchases (id);
CREATE INDEX ix_purchases_status ON purchases (status);
CREATE UNIQUE INDEX ix_payslips_reference ON payslips (reference);
CREATE INDEX ix_payslips_id ON payslips (id);
CREATE INDEX ix_payslips_year ON payslips (year);
CREATE INDEX ix_payslips_status ON payslips (status);
CREATE INDEX ix_payslips_month ON payslips (month);
CREATE INDEX ix_support_requests_email ON support_requests (email);
CREATE INDEX ix_support_requests_status ON support_requests (status);
CREATE INDEX ix_support_requests_category ON support_requests (category);
CREATE INDEX ix_support_requests_id ON support_requests (id);
CREATE INDEX ix_price_history_product_id ON price_history (product_id);
CREATE INDEX ix_price_history_id ON price_history (id);
CREATE UNIQUE INDEX ix_sales_client_id ON sales (client_id);
CREATE UNIQUE INDEX ix_sales_reference ON sales (reference);
CREATE INDEX ix_sales_id ON sales (id);
CREATE INDEX ix_bank_deposits_status ON bank_deposits (status);
CREATE INDEX ix_bank_deposits_id ON bank_deposits (id);
CREATE INDEX ix_stock_movements_id ON stock_movements (id);
CREATE INDEX ix_stock_lots_product_id ON stock_lots (product_id);
CREATE INDEX ix_stock_lots_id ON stock_lots (id);
CREATE INDEX ix_stock_transfer_items_id ON stock_transfer_items (id);
CREATE INDEX ix_stock_transfer_items_transfer_id ON stock_transfer_items (transfer_id);
CREATE UNIQUE INDEX ix_proformas_reference ON proformas (reference);
CREATE INDEX ix_proformas_status ON proformas (status);
CREATE INDEX ix_proformas_id ON proformas (id);
CREATE INDEX ix_proformas_kind ON proformas (kind);
CREATE INDEX ix_order_items_id ON order_items (id);
CREATE INDEX ix_purchase_items_id ON purchase_items (id);
CREATE INDEX ix_payslip_lines_id ON payslip_lines (id);
CREATE INDEX ix_sale_payments_id ON sale_payments (id);
CREATE INDEX ix_sale_items_id ON sale_items (id);
CREATE UNIQUE INDEX ix_sale_returns_reference ON sale_returns (reference);
CREATE INDEX ix_sale_returns_id ON sale_returns (id);
CREATE INDEX ix_proforma_items_id ON proforma_items (id);
CREATE UNIQUE INDEX ix_deliveries_reference ON deliveries (reference);
CREATE INDEX ix_deliveries_status ON deliveries (status);
CREATE INDEX ix_deliveries_id ON deliveries (id);
CREATE INDEX ix_notifications_id ON notifications (id);
CREATE INDEX ix_debts_kind ON debts (kind);
CREATE INDEX ix_debts_id ON debts (id);
CREATE INDEX ix_fne_invoices_id ON fne_invoices (id);
CREATE INDEX ix_fne_invoices_status ON fne_invoices (status);
CREATE INDEX ix_sale_return_items_id ON sale_return_items (id);
CREATE INDEX ix_delivery_items_id ON delivery_items (id);
CREATE INDEX ix_debt_payments_receipt_reference ON debt_payments (receipt_reference);
CREATE INDEX ix_debt_payments_id ON debt_payments (id);
COMMIT;
