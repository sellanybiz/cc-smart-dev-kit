"use client";

import {
  type ColumnVisibilityState,
  columnVisibilityFeature,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  FlexRender,
  type RowData,
  rowPaginationFeature,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  Columns3Icon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** The table features every portal table registers (TanStack Table v9 tree-shakes the rest). */
export const TABLE_FEATURES = tableFeatures({
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
});

export type TableFeatures = typeof TABLE_FEATURES;

/** A column helper for rows of `T`. */
export function columnsFor<T extends RowData>() {
  return createColumnHelper<TableFeatures, T>();
}

/** A table's columns, as `columnsFor<T>().columns([...])` makes them. */
export type Columns<T extends RowData> = ReturnType<ReturnType<typeof columnsFor<T>>["columns"]>;

const PAGE_SIZE = 10;

/**
 * One table: sortable headers, the columns menu, and the pager. `pager` replaces the built-in
 * one when the rows are a page the server cut (the request log's cursor).
 */
export function PortalTable<T extends RowData>({
  rows,
  columns,
  empty,
  rowKey,
  label,
  pager,
}: {
  rows: T[];
  columns: Columns<T>;
  empty: ReactNode;
  rowKey: (row: T, index: number) => string;
  label: string;
  pager?: ReactNode;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({});
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: pager === undefined ? PAGE_SIZE : Number.MAX_SAFE_INTEGER,
  });
  const table = useTable({
    features: TABLE_FEATURES,
    data: rows,
    columns,
    state: { sorting, columnVisibility, pagination },
    getRowId: rowKey,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
  });
  const pageCount = Math.max(1, table.getPageCount());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3Icon data-icon="inline-start" aria-hidden="true" />
              Columns
              <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(value === true)}
                >
                  {typeof column.columnDef.header === "string"
                    ? column.columnDef.header
                    : column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table aria-label={label}>
          <TableHeader className="bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      aria-sort={
                        sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : undefined
                      }
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <FlexRender header={header} />
                          {sorted === "asc" && (
                            <ArrowUpIcon className="size-3.5" aria-hidden="true" />
                          )}
                          {sorted === "desc" && (
                            <ArrowDownIcon className="size-3.5" aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        <FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {pager}
      {pager === undefined && rows.length > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-6 px-2">
          <p className="text-sm font-medium" aria-live="polite">
            Page {table.state.pagination.pageIndex + 1} of {pageCount}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">First page</span>
              <ChevronsLeftIcon aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Previous page</span>
              <ChevronLeftIcon aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Next page</span>
              <ChevronRightIcon aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.setPageIndex(pageCount - 1)}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Last page</span>
              <ChevronsRightIcon aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export interface TableTab {
  value: string;
  label: string;
  /** Shown beside the label when above zero: how many rows the tab holds. */
  badge?: number;
  /** The tab's table: a `PortalTable`, or the request log's own. */
  content: ReactNode;
}

/**
 * dashboard-01's data table with tabs: one table per tab, the tab list on the left and the
 * page's own actions on the right. Each tab brings its table; nothing here knows the rows.
 */
export function DataTable({
  tabs,
  label,
  actions,
}: {
  tabs: TableTab[];
  label: string;
  actions?: ReactNode;
}) {
  const first = tabs[0]?.value ?? "";
  return (
    <Tabs defaultValue={first} className="w-full flex-col justify-start gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 lg:px-6">
        <TabsList
          aria-label={label}
          className="**:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:bg-muted-foreground/30 **:data-[slot=badge]:px-1"
        >
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <Badge variant="secondary">{tab.badge}</Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {actions}
      </div>
      {tabs.map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          className="relative flex flex-col px-4 lg:px-6"
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
