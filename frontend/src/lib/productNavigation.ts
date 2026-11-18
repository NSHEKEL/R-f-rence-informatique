export function productStep<T extends { id: number }>(products: T[], id: number, direction: -1 | 1): number | null {
  const index = products.findIndex((product) => product.id === id);
  const next = index + direction;
  return index >= 0 && next >= 0 && next < products.length ? products[next].id : null;
}
