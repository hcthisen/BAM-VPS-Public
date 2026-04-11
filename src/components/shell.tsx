import Link from "next/link";
import { type ReactNode } from "react";

import { logoutAdminAction } from "@/app/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { appName, navItems } from "@/lib/constants";

type ShellProps = {
  children: ReactNode;
};

export function Shell({ children }: ShellProps) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">B</div>
          <div>
            <p className="eyebrow">Blog Automation Machine</p>
            <h1>{appName}</h1>
          </div>
        </div>

        <nav className="nav">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="nav-link">
              {item.label}
            </Link>
          ))}
        </nav>

        <AutoRefresh />
        <form action={logoutAdminAction} className="sidebar-footer">
          <button className="button secondary" type="submit">
            Logout
          </button>
        </form>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}

