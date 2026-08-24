"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Bell,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Settings,
  LogOut,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface AppShellProps {
  user: {
    name: string;
    email: string;
    role: string;
    officeName?: string | null;
  };
  unreadCount?: number;
  children: React.ReactNode;
}

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["CS", "PROCUREMENT", "ADMIN"] },
  { href: "/catalog", label: "Catalog", icon: Package, roles: ["CS", "PROCUREMENT", "ADMIN"] },
  { href: "/orders", label: "Orders", icon: ShoppingCart, roles: ["CS"] },
  { href: "/orders/new", label: "New Order", icon: ClipboardList, roles: ["CS"] },
  { href: "/procurement", label: "Procurement", icon: ClipboardList, roles: ["PROCUREMENT", "ADMIN"] },
  { href: "/admin/budgets", label: "Budgets", icon: Settings, roles: ["ADMIN"] },
  { href: "/admin/catalog", label: "Catalog Admin", icon: Settings, roles: ["ADMIN"] },
];

export function AppShell({ user, unreadCount = 0, children }: AppShellProps) {
  const pathname = usePathname();
  const visibleNav = navItems.filter((item) => item.roles.includes(user.role));

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <Link href="/" className="text-xl font-bold text-indigo-700">
              OvaBuy
            </Link>
            <p className="text-xs text-slate-500">
              APAC hardware ordering — Client Services to Procurement
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/notifications"
              className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>
            <div className="hidden text-right text-sm sm:block">
              <p className="font-medium text-slate-900">{user.name}</p>
              <p className="text-xs text-slate-500">
                {user.role.replace("_", " ")}
                {user.officeName ? ` · ${user.officeName}` : ""}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => signOut({ callbackUrl: "/login" })}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <nav className="mx-auto max-w-7xl overflow-x-auto px-4 sm:px-6">
          <div className="flex gap-1 pb-2">
            {visibleNav.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap",
                    active
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-slate-600 hover:bg-slate-100"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
