export type PaginationInput = { page: number; limit: number };

export function pagination(input: PaginationInput): { skip: number; take: number } {
  return { skip: (input.page - 1) * input.limit, take: input.limit };
}

export function paginationMeta(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasNextPage: page * limit < total,
    hasPreviousPage: page > 1,
  };
}
