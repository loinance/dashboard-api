import ExcelJS from 'exceljs'
import type { Response } from 'express'
import { formatIstDateTime, istTodayKey } from '../../lib/ist.js'
import {
  EMPLOYMENT_LABELS,
  LOAN_TYPE_LABELS,
  STATUS_LABELS,
  labelFor,
} from './constants.js'
import { selectExportBatch } from './repository.js'
import type { LeadFilter } from './schemas.js'

/** Indian digit grouping — 6,00,000 rather than 600,000. */
const RUPEE_FORMAT = '#,##,##0'

const COLUMNS = [
  { header: 'Date', width: 18 },
  { header: 'Name', width: 26 },
  { header: 'Mobile', width: 15 },
  { header: 'Loan Type', width: 16 },
  { header: 'Amount (₹)', width: 16 },
  { header: 'Monthly Income (₹)', width: 20 },
  { header: 'Employment', width: 16 },
  { header: 'Status', width: 14 },
  { header: 'Source', width: 14 },
  { header: 'Flags', width: 30 },
  { header: 'Notes', width: 40 },
] as const

const BATCH_SIZE = 500

export function exportFilename(now = new Date()): string {
  return `loinance-leads-${istTodayKey(now)}.xlsx`
}

/**
 * §9 — streamed with the ExcelJS streaming writer. The workbook is never built
 * in memory, and rows are pulled from Postgres in batches, so a 10,000-row
 * export costs a bounded amount of RAM.
 *
 * Returns the number of rows written, for the audit entry.
 */
export async function streamLeadsWorkbook(
  res: Response,
  filter: LeadFilter,
  maxRows: number,
): Promise<number> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: res,
    useStyles: true,
    useSharedStrings: false,
  })
  workbook.creator = 'Loinance dashboard'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Leads', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  sheet.columns = COLUMNS.map((column) => ({ header: column.header, width: column.width }))
  sheet.getRow(1).font = { bold: true }
  sheet.getRow(1).commit()

  let written = 0
  let offset = 0

  for (;;) {
    const size = Math.min(BATCH_SIZE, maxRows - written)
    if (size <= 0) break

    const batch = await selectExportBatch(filter, offset, size)
    if (batch.length === 0) break

    for (const lead of batch) {
      const row = sheet.addRow([
        formatIstDateTime(lead.createdAt),
        lead.fullName,
        // Text, not a number: a leading digit must never be eaten and it must
        // never render as 9.84449E+09.
        lead.mobile,
        labelFor(LOAN_TYPE_LABELS, lead.loanType),
        lead.amount,
        lead.income,
        labelFor(EMPLOYMENT_LABELS, lead.employment),
        labelFor(STATUS_LABELS, lead.status),
        lead.source ?? '',
        (lead.riskFlags ?? []).join(', '),
        lead.notes ?? '',
      ])

      row.getCell(3).numFmt = '@'
      row.getCell(5).numFmt = RUPEE_FORMAT
      row.getCell(6).numFmt = RUPEE_FORMAT
      row.commit()
    }

    written += batch.length
    offset += batch.length
    if (batch.length < size) break
  }

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } }
  sheet.commit()
  await workbook.commit()

  return written
}
