import { clipboard, ipcMain } from 'electron'
import {
  type CrashReportCopyDiagnosticsArgs,
  type CrashReportSubmitArgs,
  formatCrashReportText
} from '../../shared/crash-reporting'
import type { CrashReportStore } from '../crash-reporting/crash-report-store'
import { rendererCrashBreadcrumbOrigin } from '../../shared/crash-breadcrumb-origin'
import {
  assertClipboardTextWriteWithinLimit,
  isClipboardTextWriteTooLargeError
} from '../../shared/clipboard-text'
import { formatCrashReportCopyText } from '../crash-reporting/crash-report-copy-text'
import {
  recentRendererErrorReportKeys,
  recordRendererErrorReport
} from './crash-reporting-renderer-error-report'
import { recordRendererBreadcrumbFromRenderer } from './crash-reporting-renderer-breadcrumbs'
import {
  getLatestPendingReport,
  getLatestSendableReport,
  getRequestedCrashReport,
  inFlightSubmissions,
  submittedReportIds
} from './crash-reporting-sendable-reports'
import { buildUncapturedCrashReportText, submitCrashReport } from './crash-reporting-submission'
import { isCapabilityEnabled } from '../../shared/disabled-capabilities'

export function _resetRendererErrorReportDedupeForTests(): void {
  recentRendererErrorReportKeys.clear()
  submittedReportIds.clear()
  inFlightSubmissions.clear()
}

export function _getCrashReportingStateSizesForTests(): {
  submittedReportIds: number
  inFlightSubmissions: number
  recentRendererErrorReportKeys: number
} {
  return {
    submittedReportIds: submittedReportIds.size,
    inFlightSubmissions: inFlightSubmissions.size,
    recentRendererErrorReportKeys: recentRendererErrorReportKeys.size
  }
}

export function registerCrashReportingHandlers(store: CrashReportStore): void {
  // Why the channels stay registered when the capability is off: the renderer
  // asks for the pending report as it mounts, and an unhandled channel rejects
  // there. Only the surfaces that would offer an upload this build cannot make
  // answer empty — recording and copying stay live, because both write nothing
  // beyond local files. `createWebDiagnosticsApi` answers the same shape.
  const reportsSurfaced = isCapabilityEnabled('crash-report')

  ipcMain.removeHandler('crashReports:getLatestPending')
  ipcMain.handle('crashReports:getLatestPending', () =>
    reportsSurfaced ? getLatestPendingReport(store) : null
  )

  ipcMain.removeHandler('crashReports:getLatestReport')
  ipcMain.handle('crashReports:getLatestReport', () =>
    reportsSurfaced ? getLatestSendableReport(store) : null
  )

  ipcMain.removeHandler('crashReports:dismiss')
  ipcMain.handle('crashReports:dismiss', async (_event, args: { reportId: string }) => {
    if (!reportsSurfaced) {
      return null
    }
    if (inFlightSubmissions.has(args.reportId)) {
      return store.getById(args.reportId)
    }
    if (submittedReportIds.has(args.reportId)) {
      const report = await store.getById(args.reportId)
      return report ? { ...report, status: 'sent' as const } : null
    }
    return store.dismiss(args.reportId)
  })

  ipcMain.removeAllListeners('crashReports:recordBreadcrumb')
  ipcMain.on(
    'crashReports:recordBreadcrumb',
    (event, args?: { name?: unknown; data?: unknown }) => {
      const senderId = event?.sender?.id
      recordRendererBreadcrumbFromRenderer(
        args,
        typeof senderId === 'number' ? rendererCrashBreadcrumbOrigin(senderId) : undefined
      )
    }
  )

  ipcMain.removeHandler('crashReports:copyLatestDiagnostics')
  ipcMain.handle(
    'crashReports:copyLatestDiagnostics',
    async (_event, args?: CrashReportCopyDiagnosticsArgs) => {
      const report = await getRequestedCrashReport(store, args)
      const baseText = report
        ? formatCrashReportText(report, args?.notes)
        : buildUncapturedCrashReportText(args?.notes)
      try {
        clipboard.writeText(
          assertClipboardTextWriteWithinLimit(
            formatCrashReportCopyText(baseText, args?.submissionFailure)
          )
        )
      } catch (error) {
        if (isClipboardTextWriteTooLargeError(error)) {
          return { ok: false as const, error: 'Crash diagnostics are too large to copy safely.' }
        }
        throw error
      }
      return { ok: true as const }
    }
  )

  ipcMain.removeHandler('crashReports:recordRendererError')
  ipcMain.handle('crashReports:recordRendererError', async (event, args: unknown) => {
    try {
      return await recordRendererErrorReport(store, args, event?.sender?.id)
    } catch (error) {
      console.error('[crash-reporting] Failed to record renderer error report:', error)
      return { ok: false, error: 'Failed to record renderer error report.' }
    }
  })

  ipcMain.removeHandler('crashReports:submit')
  ipcMain.handle('crashReports:submit', async (_event, args: CrashReportSubmitArgs) => {
    if (!reportsSurfaced) {
      return {
        ok: false as const,
        status: null,
        error: 'Sending crash reports is disabled in this build.'
      }
    }
    return submitCrashReport(store, args)
  })
}
