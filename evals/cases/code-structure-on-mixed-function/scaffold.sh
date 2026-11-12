#!/usr/bin/env bash
# Builds this case's workspace (runs only with --scaffold).
set -eu
mkdir -p src
cat > src/order.js <<'JS'
export async function processOrder(rawOrder, database) {
  const order = JSON.parse(rawOrder);
  if (typeof order.customerId !== "string" || order.customerId.length === 0) {
    throw new Error("An order needs a customer id");
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new Error("An order needs at least one item");
  }
  for (const item of order.items) {
    if (typeof item.sku !== "string" || !Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error("Each item needs a SKU and a positive whole quantity");
    }
  }
  return await database.orders.insert(order);
}
JS
