import 'dotenv/config'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { connectDatabase, disconnectDatabase } from '@/config/database.js'
import { env } from '@/config/env.js'
import { officialHolidayYearRepository } from '@/modules/calendar/repositories/official-holiday-year.repository.js'
import { validateOfficialHolidayYearInput } from '@/modules/calendar/validations/official-holiday.validation.js'

const COMPILED_DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../modules/calendar/data/official-holidays',
)
const SOURCE_DATA_DIR = path.resolve(process.cwd(), 'src/modules/calendar/data/official-holidays')
const DATA_DIR = existsSync(COMPILED_DATA_DIR) ? COMPILED_DATA_DIR : SOURCE_DATA_DIR

const parseCliArgs = (): {
  validateOnly: boolean
  rollbackYear?: number
  targetVersion?: number
} => {
  const args = process.argv.slice(2)
  const validateOnly = args.includes('--validate-only')
  const rollbackIndex = args.indexOf('--rollback')
  if (rollbackIndex !== -1) {
    const yearArg = Number(args[rollbackIndex + 1])
    const versionArg = Number(args[rollbackIndex + 2])
    if (!Number.isInteger(yearArg) || !Number.isInteger(versionArg)) {
      throw new Error('Cú pháp rollback: --rollback <year> <targetVersion>')
    }
    return { validateOnly, rollbackYear: yearArg, targetVersion: versionArg }
  }
  return { validateOnly }
}

const loadValidatedHolidayFiles = async () => {
  const files = (await readdir(DATA_DIR))
    .filter((name) => name.endsWith('.json'))
    .sort()

  const records = []
  for (const fileName of files) {
    const rawText = await readFile(path.join(DATA_DIR, fileName), 'utf8')
    const parsed: unknown = JSON.parse(rawText)
    records.push({
      fileName,
      data: validateOfficialHolidayYearInput(parsed),
    })
  }
  return records
}

const run = async (): Promise<void> => {
  const { validateOnly, rollbackYear, targetVersion } = parseCliArgs()
  const validatedFiles = await loadValidatedHolidayFiles()

  console.info(`Validated ${validatedFiles.length} official holiday file(s) in ${DATA_DIR}`)
  if (validateOnly) return

  if (!env.mongoUri) throw new Error('MONGODB_URI is required')
  await connectDatabase(env.mongoUri)

  try {
    if (rollbackYear !== undefined && targetVersion !== undefined) {
      const rolledBack = await officialHolidayYearRepository.rollbackYearToVersion(
        rollbackYear,
        targetVersion,
      )
      console.info(`Rolled back year ${rollbackYear} to version ${targetVersion} (new version: ${rolledBack.version})`)
      return
    }

    let syncedCount = 0
    for (const { fileName, data } of validatedFiles) {
      if (data.status !== 'confirmed') {
        console.info(`Skipped ${fileName} (status=${data.status}; only confirmed files sync to DB)`)
        continue
      }
      const saved = await officialHolidayYearRepository.upsertYear(data)
      syncedCount += 1
      console.info(`Synced ${fileName}: year=${saved.year}, status=${saved.status}, version=${saved.version}`)
    }
    console.info(`Official holiday sync completed (${syncedCount} confirmed year(s) synced).`)
  } finally {
    await disconnectDatabase()
  }
}

void run().catch((error: unknown) => {
  console.error('Official holiday sync failed:', error instanceof Error ? error.message : 'Unknown error')
  process.exitCode = 1
})
