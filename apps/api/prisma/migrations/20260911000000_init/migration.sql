-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "role" AS ENUM ('ADMIN', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "payment_type" AS ENUM ('CASH', 'LENT');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('OPEN', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "stock_movement_reason" AS ENUM ('BATCH_ADD', 'BATCH_EDIT', 'BATCH_DELETE', 'ORDER_CREATE', 'ORDER_LINE_EDIT', 'ORDER_CANCEL', 'RETURN_ACCEPTED', 'RETURN_EDIT', 'RETURN_DELETE', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ledger_entry_type" AS ENUM ('PAYMENT', 'REFUND', 'PAYMENT_REVERSAL', 'REFUND_REVERSAL');

-- CreateEnum
CREATE TYPE "ledger_entry_source" AS ENUM ('ORDER_CREATE', 'ORDER_LINE_EDIT', 'ORDER_CANCEL', 'MANUAL', 'PAYMENT_DELETE', 'RETURN_CREATE', 'RETURN_EDIT', 'RETURN_DELETE');

-- CreateEnum
CREATE TYPE "return_reversal_kind" AS ENUM ('EDIT', 'DELETE');

-- CreateEnum
CREATE TYPE "upload_kind" AS ENUM ('ITEM_IMAGE', 'FACTORY_LOGO');

-- CreateEnum
CREATE TYPE "refresh_token_status" AS ENUM ('ACTIVE', 'ROTATED', 'RETIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "session_revoke_reason" AS ENUM ('LOGOUT', 'LOGOUT_ALL', 'REUSE_DETECTED', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'USER_DEACTIVATED');

-- CreateEnum
CREATE TYPE "idempotency_scope" AS ENUM ('ORDER_CREATE', 'RETURN_CREATE', 'PAYMENT_CREATE');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'CANCEL', 'STOCK_ADJUST', 'PAYMENT_CREATE', 'PAYMENT_REVERSE', 'RETURN_CREATE', 'RETURN_EDIT', 'RETURN_DELETE', 'REFUND_CREATE', 'REFUND_REVERSE', 'CREDIT_OVERRIDE', 'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOCKOUT', 'LOGOUT', 'LOGOUT_ALL', 'SESSION_REUSE_DETECTED', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'PERMISSION_CHANGE', 'SETTINGS_CHANGE', 'USER_DEACTIVATE', 'USER_ACTIVATE', 'UPLOAD_CREATE');

-- CreateEnum
CREATE TYPE "audit_entity_type" AS ENUM ('USER', 'SESSION', 'ITEM', 'PURCHASE_BATCH', 'CUSTOMER', 'DRIVER', 'ORDER', 'RETURN', 'LEDGER_ENTRY', 'SETTINGS', 'UPLOAD');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(32) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "user_id" INTEGER NOT NULL,
    "permission_key" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id","permission_key")
);

-- CreateTable
CREATE TABLE "session_families" (
    "id" UUID NOT NULL,
    "user_id" INTEGER NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" "session_revoke_reason",
    "created_ip" VARCHAR(45) NOT NULL,
    "user_agent" VARCHAR(255),
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "status" "refresh_token_status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "rotated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_throttles" (
    "ip" VARCHAR(45) NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,
    "locked_until" TIMESTAMPTZ(3),
    "lockout_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("ip","username")
);

-- CreateTable
CREATE TABLE "factory_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "factory_name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(100) NOT NULL,
    "address" VARCHAR(300) NOT NULL,
    "logo_upload_id" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_user_id" INTEGER,

    CONSTRAINT "factory_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" SERIAL NOT NULL,
    "file_name" VARCHAR(64) NOT NULL,
    "kind" "upload_kind" NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "image_upload_id" INTEGER,
    "deposit_price" BIGINT NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "min_stock" INTEGER,
    "archived_at" TIMESTAMPTZ(3),
    "archived_by_user_id" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_batches" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost" BIGINT NOT NULL,
    "total_cost" BIGINT NOT NULL,
    "note" VARCHAR(500),
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_user_id" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,

    CONSTRAINT "purchase_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" "stock_movement_reason" NOT NULL,
    "batch_id" INTEGER,
    "order_id" INTEGER,
    "return_id" INTEGER,
    "note" VARCHAR(500),
    "created_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "alt_phone" VARCHAR(20),
    "address" VARCHAR(300) NOT NULL,
    "credit_limit" BIGINT,
    "archived_at" TIMESTAMPTZ(3),
    "archived_by_user_id" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "car_number" VARCHAR(50) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "archived_by_user_id" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_counter" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_counter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "order_number" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "driver_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "payment_type" "payment_type" NOT NULL,
    "notes" VARCHAR(1000),
    "status" "order_status" NOT NULL DEFAULT 'OPEN',
    "deposit_total" BIGINT NOT NULL DEFAULT 0,
    "payments_net" BIGINT NOT NULL DEFAULT 0,
    "credits_total" BIGINT NOT NULL DEFAULT 0,
    "refunds_net" BIGINT NOT NULL DEFAULT 0,
    "owed" BIGINT NOT NULL DEFAULT 0,
    "out_quantity_total" INTEGER NOT NULL DEFAULT 0,
    "out_value" BIGINT NOT NULL DEFAULT 0,
    "held" BIGINT NOT NULL DEFAULT 0,
    "compensation" BIGINT NOT NULL DEFAULT 0,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_user_id" INTEGER,
    "credit_override_by_user_id" INTEGER,
    "credit_override_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_deposit" BIGINT NOT NULL,
    "line_total" BIGINT NOT NULL,
    "returned_accepted" INTEGER NOT NULL DEFAULT 0,
    "returned_damaged" INTEGER NOT NULL DEFAULT 0,
    "out_quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "notes" VARCHAR(1000),
    "refund_due" BIGINT NOT NULL,
    "owed_before" BIGINT NOT NULL,
    "cash_refund" BIGINT NOT NULL,
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by_user_id" INTEGER,
    "reversal_kind" "return_reversal_kind",
    "replaced_by_return_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" INTEGER NOT NULL,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_lines" (
    "id" SERIAL NOT NULL,
    "return_id" INTEGER NOT NULL,
    "order_line_id" INTEGER NOT NULL,
    "accepted_quantity" INTEGER NOT NULL,
    "damaged_quantity" INTEGER NOT NULL,
    "unit_deposit" BIGINT NOT NULL,
    "damaged_refund" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "type" "ledger_entry_type" NOT NULL,
    "source" "ledger_entry_source" NOT NULL,
    "amount" BIGINT NOT NULL,
    "date" DATE,
    "is_automatic" BOOLEAN NOT NULL DEFAULT false,
    "return_id" INTEGER,
    "reverses_entry_id" INTEGER,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" INTEGER NOT NULL,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "scope" "idempotency_scope" NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" INTEGER,
    "username_attempt" VARCHAR(64),
    "action" "audit_action" NOT NULL,
    "entity_type" "audit_entity_type" NOT NULL,
    "entity_id" VARCHAR(64),
    "summary_key" VARCHAR(100) NOT NULL,
    "summary_params" JSONB NOT NULL DEFAULT '{}',
    "ip" VARCHAR(45),
    "request_id" VARCHAR(64),
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_role_is_active_idx" ON "users"("role", "is_active");

-- CreateIndex
CREATE INDEX "session_families_user_id_revoked_at_idx" ON "session_families"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_status_idx" ON "refresh_tokens"("family_id", "status");

-- CreateIndex
CREATE INDEX "login_throttles_username_idx" ON "login_throttles"("username");

-- CreateIndex
CREATE INDEX "factory_settings_logo_upload_id_idx" ON "factory_settings"("logo_upload_id");

-- CreateIndex
CREATE INDEX "factory_settings_updated_by_user_id_idx" ON "factory_settings"("updated_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uploads_file_name_key" ON "uploads"("file_name");

-- CreateIndex
CREATE INDEX "uploads_created_by_user_id_idx" ON "uploads"("created_by_user_id");

-- CreateIndex
CREATE INDEX "items_image_upload_id_idx" ON "items"("image_upload_id");

-- CreateIndex
CREATE INDEX "items_archived_at_idx" ON "items"("archived_at");

-- CreateIndex
CREATE INDEX "items_archived_by_user_id_idx" ON "items"("archived_by_user_id");

-- CreateIndex
CREATE INDEX "items_created_by_user_id_idx" ON "items"("created_by_user_id");

-- CreateIndex
CREATE INDEX "purchase_batches_item_id_date_idx" ON "purchase_batches"("item_id", "date");

-- CreateIndex
CREATE INDEX "purchase_batches_date_idx" ON "purchase_batches"("date");

-- CreateIndex
CREATE INDEX "purchase_batches_deleted_by_user_id_idx" ON "purchase_batches"("deleted_by_user_id");

-- CreateIndex
CREATE INDEX "purchase_batches_created_by_user_id_idx" ON "purchase_batches"("created_by_user_id");

-- CreateIndex
CREATE INDEX "stock_movements_item_id_created_at_idx" ON "stock_movements"("item_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_batch_id_idx" ON "stock_movements"("batch_id");

-- CreateIndex
CREATE INDEX "stock_movements_order_id_idx" ON "stock_movements"("order_id");

-- CreateIndex
CREATE INDEX "stock_movements_return_id_idx" ON "stock_movements"("return_id");

-- CreateIndex
CREATE INDEX "stock_movements_created_by_user_id_idx" ON "stock_movements"("created_by_user_id");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_alt_phone_idx" ON "customers"("alt_phone");

-- CreateIndex
CREATE INDEX "customers_archived_at_idx" ON "customers"("archived_at");

-- CreateIndex
CREATE INDEX "customers_archived_by_user_id_idx" ON "customers"("archived_by_user_id");

-- CreateIndex
CREATE INDEX "customers_created_by_user_id_idx" ON "customers"("created_by_user_id");

-- CreateIndex
CREATE INDEX "drivers_archived_at_idx" ON "drivers"("archived_at");

-- CreateIndex
CREATE INDEX "drivers_archived_by_user_id_idx" ON "drivers"("archived_by_user_id");

-- CreateIndex
CREATE INDEX "drivers_created_by_user_id_idx" ON "drivers"("created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "orders_customer_id_status_idx" ON "orders"("customer_id", "status");

-- CreateIndex
CREATE INDEX "orders_driver_id_idx" ON "orders"("driver_id");

-- CreateIndex
CREATE INDEX "orders_date_idx" ON "orders"("date");

-- CreateIndex
CREATE INDEX "orders_status_date_idx" ON "orders"("status", "date");

-- CreateIndex
CREATE INDEX "orders_cancelled_by_user_id_idx" ON "orders"("cancelled_by_user_id");

-- CreateIndex
CREATE INDEX "orders_credit_override_by_user_id_idx" ON "orders"("credit_override_by_user_id");

-- CreateIndex
CREATE INDEX "orders_created_by_user_id_idx" ON "orders"("created_by_user_id");

-- CreateIndex
CREATE INDEX "order_lines_item_id_idx" ON "order_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_order_id_item_id_key" ON "order_lines"("order_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "returns_replaced_by_return_id_key" ON "returns"("replaced_by_return_id");

-- CreateIndex
CREATE INDEX "returns_order_id_idx" ON "returns"("order_id");

-- CreateIndex
CREATE INDEX "returns_date_idx" ON "returns"("date");

-- CreateIndex
CREATE INDEX "returns_reversed_by_user_id_idx" ON "returns"("reversed_by_user_id");

-- CreateIndex
CREATE INDEX "returns_created_by_user_id_idx" ON "returns"("created_by_user_id");

-- CreateIndex
CREATE INDEX "return_lines_order_line_id_idx" ON "return_lines"("order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_lines_return_id_order_line_id_key" ON "return_lines"("return_id", "order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_reverses_entry_id_key" ON "ledger_entries"("reverses_entry_id");

-- CreateIndex
CREATE INDEX "ledger_entries_order_id_idx" ON "ledger_entries"("order_id");

-- CreateIndex
CREATE INDEX "ledger_entries_type_date_idx" ON "ledger_entries"("type", "date");

-- CreateIndex
CREATE INDEX "ledger_entries_date_idx" ON "ledger_entries"("date");

-- CreateIndex
CREATE INDEX "ledger_entries_return_id_idx" ON "ledger_entries"("return_id");

-- CreateIndex
CREATE INDEX "ledger_entries_created_by_user_id_idx" ON "ledger_entries"("created_by_user_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_key_key" ON "idempotency_keys"("user_id", "key");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_families" ADD CONSTRAINT "session_families_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "session_families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_settings" ADD CONSTRAINT "factory_settings_logo_upload_id_fkey" FOREIGN KEY ("logo_upload_id") REFERENCES "uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_settings" ADD CONSTRAINT "factory_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_image_upload_id_fkey" FOREIGN KEY ("image_upload_id") REFERENCES "uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_archived_by_user_id_fkey" FOREIGN KEY ("archived_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_batches" ADD CONSTRAINT "purchase_batches_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_batches" ADD CONSTRAINT "purchase_batches_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_batches" ADD CONSTRAINT "purchase_batches_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "purchase_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_archived_by_user_id_fkey" FOREIGN KEY ("archived_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_archived_by_user_id_fkey" FOREIGN KEY ("archived_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_credit_override_by_user_id_fkey" FOREIGN KEY ("credit_override_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_reversed_by_user_id_fkey" FOREIGN KEY ("reversed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_replaced_by_return_id_fkey" FOREIGN KEY ("replaced_by_return_id") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_entry_id_fkey" FOREIGN KEY ("reverses_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────
-- Raw SQL that Prisma cannot express (source: prisma/sql/constraints.sql)
-- ─────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Pallet System — integrity rules Prisma cannot express.
-- Appended verbatim to the END of the initial migration
-- (apps/api/prisma/migrations/<timestamp>_init/migration.sql). PostgreSQL 18.
-- Naming: CHECK constraints `<table>_<rule>_check`; triggers named per table.
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- ─── users ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD CONSTRAINT users_username_format_check CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
  ADD CONSTRAINT users_display_name_not_blank_check CHECK (btrim(display_name) <> ''),
  ADD CONSTRAINT users_token_version_nonnegative_check CHECK (token_version >= 0),
  ADD CONSTRAINT users_version_positive_check CHECK (version >= 1);

-- ─── sessions ────────────────────────────────────────────────────────────────────────────
ALTER TABLE session_families
  ADD CONSTRAINT session_families_revocation_consistent_check
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL));

ALTER TABLE refresh_tokens
  ADD CONSTRAINT refresh_tokens_token_hash_format_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT refresh_tokens_rotated_at_consistent_check CHECK (
    (status = 'ACTIVE' AND rotated_at IS NULL)
    OR (status IN ('ROTATED', 'RETIRED') AND rotated_at IS NOT NULL)
    OR status = 'REVOKED'
  );

-- At most one ACTIVE token per session family (the family "head").
CREATE UNIQUE INDEX refresh_tokens_one_active_per_family
  ON refresh_tokens (family_id)
  WHERE status = 'ACTIVE';

ALTER TABLE login_throttles
  ADD CONSTRAINT login_throttles_failure_count_nonnegative_check CHECK (failure_count >= 0),
  ADD CONSTRAINT login_throttles_lockout_count_nonnegative_check CHECK (lockout_count >= 0);

-- ─── settings & uploads ─────────────────────────────────────────────────────────────────
ALTER TABLE factory_settings
  ADD CONSTRAINT factory_settings_singleton_check CHECK (id = 1),
  ADD CONSTRAINT factory_settings_version_positive_check CHECK (version >= 1);

ALTER TABLE uploads
  ADD CONSTRAINT uploads_file_name_format_check CHECK (file_name ~ '^[0-9a-f]{32}\.webp$'),
  ADD CONSTRAINT uploads_dimensions_positive_check CHECK (width > 0 AND height > 0),
  ADD CONSTRAINT uploads_size_bytes_positive_check CHECK (size_bytes > 0);

-- ─── items & purchase batches ───────────────────────────────────────────────────────────
ALTER TABLE items
  ADD CONSTRAINT items_name_not_blank_check CHECK (btrim(name) <> ''),
  ADD CONSTRAINT items_deposit_price_nonnegative_check CHECK (deposit_price >= 0),
  ADD CONSTRAINT items_quantity_on_hand_nonnegative_check CHECK (quantity_on_hand >= 0),
  ADD CONSTRAINT items_min_stock_nonnegative_check CHECK (min_stock IS NULL OR min_stock >= 0),
  ADD CONSTRAINT items_archive_consistent_check CHECK ((archived_at IS NULL) = (archived_by_user_id IS NULL)),
  ADD CONSTRAINT items_version_positive_check CHECK (version >= 1);

ALTER TABLE purchase_batches
  ADD CONSTRAINT purchase_batches_quantity_positive_check CHECK (quantity > 0),
  ADD CONSTRAINT purchase_batches_unit_cost_nonnegative_check CHECK (unit_cost >= 0),
  ADD CONSTRAINT purchase_batches_total_cost_matches_check CHECK (total_cost = quantity::bigint * unit_cost),
  ADD CONSTRAINT purchase_batches_delete_consistent_check CHECK ((deleted_at IS NULL) = (deleted_by_user_id IS NULL)),
  ADD CONSTRAINT purchase_batches_version_positive_check CHECK (version >= 1);

-- ─── stock ledger ───────────────────────────────────────────────────────────────────────
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_quantity_nonzero_check CHECK (quantity <> 0),
  ADD CONSTRAINT stock_movements_reference_matches_reason_check CHECK (
    (reason IN ('BATCH_ADD', 'BATCH_EDIT', 'BATCH_DELETE')
      AND batch_id IS NOT NULL AND order_id IS NULL AND return_id IS NULL)
    OR (reason IN ('ORDER_CREATE', 'ORDER_LINE_EDIT', 'ORDER_CANCEL')
      AND order_id IS NOT NULL AND batch_id IS NULL AND return_id IS NULL)
    OR (reason IN ('RETURN_ACCEPTED', 'RETURN_EDIT', 'RETURN_DELETE')
      AND return_id IS NOT NULL AND order_id IS NOT NULL AND batch_id IS NULL)
    OR (reason = 'MANUAL_ADJUSTMENT'
      AND note IS NOT NULL AND btrim(note) <> '' AND batch_id IS NULL AND order_id IS NULL AND return_id IS NULL)
  ),
  ADD CONSTRAINT stock_movements_quantity_sign_check CHECK (
    (reason IN ('BATCH_ADD', 'ORDER_CANCEL', 'RETURN_ACCEPTED') AND quantity > 0)
    OR (reason IN ('BATCH_DELETE', 'ORDER_CREATE', 'RETURN_EDIT', 'RETURN_DELETE') AND quantity < 0)
    OR reason IN ('BATCH_EDIT', 'ORDER_LINE_EDIT', 'MANUAL_ADJUSTMENT')
  );

-- ─── customers & drivers ────────────────────────────────────────────────────────────────
ALTER TABLE customers
  ADD CONSTRAINT customers_name_not_blank_check CHECK (btrim(name) <> ''),
  ADD CONSTRAINT customers_phone_format_check CHECK (phone ~ '^\+?[0-9]{7,15}$'),
  ADD CONSTRAINT customers_alt_phone_format_check CHECK (alt_phone IS NULL OR alt_phone ~ '^\+?[0-9]{7,15}$'),
  ADD CONSTRAINT customers_credit_limit_nonnegative_check CHECK (credit_limit IS NULL OR credit_limit >= 0),
  ADD CONSTRAINT customers_archive_consistent_check CHECK ((archived_at IS NULL) = (archived_by_user_id IS NULL)),
  ADD CONSTRAINT customers_version_positive_check CHECK (version >= 1);

ALTER TABLE drivers
  ADD CONSTRAINT drivers_name_not_blank_check CHECK (btrim(name) <> ''),
  ADD CONSTRAINT drivers_phone_format_check CHECK (phone ~ '^\+?[0-9]{7,15}$'),
  ADD CONSTRAINT drivers_car_number_not_blank_check CHECK (btrim(car_number) <> ''),
  ADD CONSTRAINT drivers_archive_consistent_check CHECK ((archived_at IS NULL) = (archived_by_user_id IS NULL)),
  ADD CONSTRAINT drivers_version_positive_check CHECK (version >= 1);

-- ─── orders ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE order_counter
  ADD CONSTRAINT order_counter_singleton_check CHECK (id = 1),
  ADD CONSTRAINT order_counter_last_number_nonnegative_check CHECK (last_number >= 0);

ALTER TABLE orders
  ADD CONSTRAINT orders_order_number_positive_check CHECK (order_number >= 1),
  ADD CONSTRAINT orders_totals_nonnegative_check CHECK (
    deposit_total >= 0 AND payments_net >= 0 AND credits_total >= 0 AND refunds_net >= 0
    AND owed >= 0 AND out_quantity_total >= 0 AND out_value >= 0 AND held >= 0 AND compensation >= 0
  ),
  ADD CONSTRAINT orders_cancel_consistent_check CHECK (
    (cancelled_at IS NULL) = (cancelled_by_user_id IS NULL)
    AND (status = 'CANCELLED') = (cancelled_at IS NOT NULL)
  ),
  ADD CONSTRAINT orders_credit_override_consistent_check
    CHECK ((credit_override_by_user_id IS NULL) = (credit_override_at IS NULL)),
  ADD CONSTRAINT orders_version_positive_check CHECK (version >= 1);

ALTER TABLE order_lines
  ADD CONSTRAINT order_lines_quantity_positive_check CHECK (quantity > 0),
  ADD CONSTRAINT order_lines_unit_deposit_nonnegative_check CHECK (unit_deposit >= 0),
  ADD CONSTRAINT order_lines_line_total_matches_check CHECK (line_total = quantity::bigint * unit_deposit),
  ADD CONSTRAINT order_lines_returned_nonnegative_check CHECK (returned_accepted >= 0 AND returned_damaged >= 0),
  ADD CONSTRAINT order_lines_out_quantity_matches_check
    CHECK (out_quantity = quantity - returned_accepted - returned_damaged),
  ADD CONSTRAINT order_lines_out_quantity_nonnegative_check CHECK (out_quantity >= 0);

-- ─── returns ────────────────────────────────────────────────────────────────────────────
ALTER TABLE returns
  ADD CONSTRAINT returns_money_nonnegative_check CHECK (refund_due >= 0 AND owed_before >= 0 AND cash_refund >= 0),
  ADD CONSTRAINT returns_cash_refund_formula_check CHECK (cash_refund = GREATEST(0, refund_due - owed_before)),
  ADD CONSTRAINT returns_reversal_consistent_check CHECK (
    (reversed_at IS NULL) = (reversed_by_user_id IS NULL)
    AND (reversed_at IS NULL) = (reversal_kind IS NULL)
  ),
  ADD CONSTRAINT returns_replacement_matches_kind_check CHECK (
    (reversal_kind IS NULL AND replaced_by_return_id IS NULL)
    OR (reversal_kind = 'DELETE' AND replaced_by_return_id IS NULL)
    OR (reversal_kind = 'EDIT' AND replaced_by_return_id IS NOT NULL)
  ),
  ADD CONSTRAINT returns_not_self_replaced_check CHECK (replaced_by_return_id IS NULL OR replaced_by_return_id <> id);

ALTER TABLE return_lines
  ADD CONSTRAINT return_lines_quantities_nonnegative_check CHECK (accepted_quantity >= 0 AND damaged_quantity >= 0),
  ADD CONSTRAINT return_lines_quantity_positive_check CHECK (accepted_quantity + damaged_quantity > 0),
  ADD CONSTRAINT return_lines_unit_deposit_nonnegative_check CHECK (unit_deposit >= 0),
  ADD CONSTRAINT return_lines_damaged_refund_range_check
    CHECK (damaged_refund >= 0 AND damaged_refund <= damaged_quantity::bigint * unit_deposit);

-- ─── money ledger ───────────────────────────────────────────────────────────────────────
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_amount_positive_check CHECK (amount > 0),
  ADD CONSTRAINT ledger_entries_reversal_reference_check
    CHECK ((type IN ('PAYMENT_REVERSAL', 'REFUND_REVERSAL')) = (reverses_entry_id IS NOT NULL)),
  ADD CONSTRAINT ledger_entries_not_self_reversal_check CHECK (reverses_entry_id IS NULL OR reverses_entry_id <> id),
  ADD CONSTRAINT ledger_entries_automatic_only_payment_check CHECK (NOT is_automatic OR type = 'PAYMENT'),
  ADD CONSTRAINT ledger_entries_date_null_only_automatic_check
    CHECK ((date IS NULL) = (is_automatic AND type = 'PAYMENT')),
  ADD CONSTRAINT ledger_entries_return_reference_check CHECK (
    (type IN ('REFUND', 'REFUND_REVERSAL') AND return_id IS NOT NULL)
    OR (type IN ('PAYMENT', 'PAYMENT_REVERSAL') AND return_id IS NULL)
  ),
  ADD CONSTRAINT ledger_entries_source_matches_type_check CHECK (
    (type = 'PAYMENT' AND is_automatic AND source IN ('ORDER_CREATE', 'ORDER_LINE_EDIT'))
    OR (type = 'PAYMENT' AND NOT is_automatic AND source = 'MANUAL')
    OR (type = 'PAYMENT_REVERSAL' AND source IN ('ORDER_LINE_EDIT', 'ORDER_CANCEL', 'PAYMENT_DELETE'))
    OR (type = 'REFUND' AND source IN ('RETURN_CREATE', 'RETURN_EDIT'))
    OR (type = 'REFUND_REVERSAL' AND source IN ('RETURN_EDIT', 'RETURN_DELETE'))
  );

-- ─── idempotency ────────────────────────────────────────────────────────────────────────
ALTER TABLE idempotency_keys
  ADD CONSTRAINT idempotency_keys_key_format_check CHECK (key ~ '^[A-Za-z0-9_-]{16,100}$'),
  ADD CONSTRAINT idempotency_keys_request_hash_format_check CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT idempotency_keys_expiry_after_creation_check CHECK (expires_at > created_at);

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Triggers
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- Append-only tables: no UPDATE, no DELETE, for any role (defence in depth on top of grants).
-- Row triggers do not fire on TRUNCATE, so the test suite's reset and pg_restore still work.
CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (% forbidden)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER forbid_update_delete BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER forbid_update_delete BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER forbid_update_delete BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER forbid_update_delete BEFORE UPDATE OR DELETE ON return_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Returns are never deleted.
CREATE TRIGGER forbid_delete BEFORE DELETE ON returns
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Returns: the only permitted UPDATE sets the four reversal columns once (from NULL), in one statement.
CREATE OR REPLACE FUNCTION returns_reversal_set_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'return % is already reversed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reversed_at IS NULL THEN
    RAISE EXCEPTION 'an UPDATE on returns must set reversed_at' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.id, NEW.order_id, NEW.date, NEW.notes, NEW.refund_due, NEW.owed_before, NEW.cash_refund,
      NEW.created_at, NEW.created_by_user_id)
     IS DISTINCT FROM
     (OLD.id, OLD.order_id, OLD.date, OLD.notes, OLD.refund_due, OLD.owed_before, OLD.cash_refund,
      OLD.created_at, OLD.created_by_user_id) THEN
    RAISE EXCEPTION 'only reversal columns of returns may be updated' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER returns_reversal_set_once BEFORE UPDATE ON returns
  FOR EACH ROW EXECUTE FUNCTION returns_reversal_set_once();

-- Ledger: a reversal row must mirror the row it reverses (same order, same amount, matching type).
CREATE OR REPLACE FUNCTION ledger_reversal_matches_original() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  original ledger_entries%ROWTYPE;
BEGIN
  IF NEW.reverses_entry_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO original FROM ledger_entries WHERE id = NEW.reverses_entry_id;
  IF NOT FOUND
     OR original.order_id <> NEW.order_id
     OR original.amount <> NEW.amount
     OR (NEW.type = 'PAYMENT_REVERSAL' AND original.type <> 'PAYMENT')
     OR (NEW.type = 'REFUND_REVERSAL' AND original.type <> 'REFUND') THEN
    RAISE EXCEPTION 'ledger reversal % does not mirror entry %', NEW.id, NEW.reverses_entry_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_reversal_matches_original BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_reversal_matches_original();

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Seed rows required by the schema itself
-- ═══════════════════════════════════════════════════════════════════════════════════════
INSERT INTO order_counter (id, last_number) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
