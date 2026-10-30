export type Role = "owner" | "staff";

export const PERMISSIONS = {
  create_transactions: ["owner", "staff"],
  manage_parties: ["owner", "staff"],
  manage_products: ["owner"],
  view_cost_profit: ["owner"], // stock value, average cost, gross/net profit, margins
  cancel_posted: ["owner"],
  adjust_stock: ["owner"],
  view_reports: ["owner", "staff"],
  export_reports: ["owner"],
  import_data: ["owner"],
  manage_settings: ["owner"],
  manage_users: ["owner"],
  view_audit: ["owner"],
  update_cheque: ["owner", "staff"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, perm: Permission): boolean {
  return (PERMISSIONS[perm] as readonly Role[]).includes(role);
}
