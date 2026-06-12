import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'

const execFileAsync = promisify(execFile)

export async function extractPdfToMarkdown(fileBuffer: Buffer): Promise<string> {
  const tmpDir = tmpdir()
  const tmpPdfPath = join(tmpDir, `pdf-${randomBytes(8).toString('hex')}.pdf`)

  try {
    // Write buffer to temp file
    await writeFile(tmpPdfPath, fileBuffer)

    // Call Python extraction script
    const { stdout, stderr } = await execFileAsync('python3', [
      join(process.cwd(), 'lib/pdf-extract.py'),
      tmpPdfPath,
    ])

    if (stderr && stderr.includes('error')) {
      throw new Error(`PDF extraction error: ${stderr}`)
    }

    const result = JSON.parse(stdout)
    if (result.error) {
      throw new Error(result.error)
    }

    return result.markdown
  } finally {
    // Clean up temp file
    await unlink(tmpPdfPath).catch(() => {})
  }
}
