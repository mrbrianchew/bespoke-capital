'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useDriveUpload, DriveDocumentGeneric } from '@/lib/useDriveUpload'

// Document attachments for a New Business case. Same Drive mechanics as
// Service Requests (useDriveUpload — drag/drop, paste-screenshot, click to
// browse), but the folder-remembering column differs by whether this case
// has a client yet:
//   - client-linked case  -> clients.new_business_drive_folder_link
//     (reused automatically across every future case for that client)
//   - prospect case (no client_id) -> new_business_cases.drive_folder_link
//     (per-case, since there's no client row to hang it off yet)
// If a prospect later converts to a client, the folder stays on the case
// record — it doesn't retroactively migrate onto the new client.

const T = {
  gold: 'var(--gold)', goldSoft: 'rgba(168,131,74,.12)',
  rose: 'var(--rouge)',
  text: 'var(--ink)', textFaint: 'var(--ink3)',
}

interface DocumentRow extends DriveDocumentGeneric {
  case_id: string
}

export default function NewBusinessCaseDocuments({ caseId, clientId }: { caseId: string; clientId: string | null }) {
  const supabase = createClient()
  const drive = useDriveUpload()

  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [driveFolder, setDriveFolder] = useState<{ id: string; name: string } | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const folderTarget = clientId
    ? { table: 'clients', idColumn: 'id', id: clientId, column: 'new_business_drive_folder_link' }
    : { table: 'new_business_cases', idColumn: 'id', id: caseId, column: 'drive_folder_link' }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [docsRes, folderRes] = await Promise.all([
        supabase.from('new_business_case_documents').select('*').eq('case_id', caseId).order('uploaded_at', { ascending: false }),
        supabase.from(folderTarget.table).select(folderTarget.column).eq(folderTarget.idColumn, folderTarget.id).maybeSingle(),
      ])
      if (cancelled) return
      setDocuments((docsRes.data || []) as DocumentRow[])
      const raw = (folderRes.data as any)?.[folderTarget.column] as string | undefined
      if (raw) { try { const parsed = JSON.parse(raw); setDriveFolder(parsed?.id && parsed?.name ? parsed : null) } catch { setDriveFolder(null) } }
      else setDriveFolder(null)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, clientId])

  async function connectDrive() {
    const folder = await drive.connectDriveFolder({ table: folderTarget.table, idColumn: folderTarget.idColumn, id: folderTarget.id }, folderTarget.column)
    if (folder) setDriveFolder(folder)
  }

  async function doUpload(files: FileList | File[]) {
    if (!driveFolder) { await connectDrive(); return }
    const uploaded = await drive.uploadFilesGeneric(files, { table: 'new_business_case_documents', idColumn: 'case_id', id: caseId }, driveFolder)
    if (uploaded.length > 0) setDocuments(prev => [...(uploaded as DocumentRow[]), ...prev])
  }

  async function removeDocument(doc: DocumentRow) {
    const ok = await drive.deleteDocumentGeneric(doc, 'new_business_case_documents')
    if (ok) setDocuments(prev => prev.filter(d => d.id !== doc.id))
  }

  // Paste-screenshot support, scoped to this case while its drawer is open.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.type.startsWith('image/')) {
          const pasted = item.getAsFile()
          if (pasted) {
            const named = new File([pasted], pasted.name || `pasted-screenshot.${item.type.split('/')[1] || 'png'}`, { type: item.type })
            doUpload([named])
          }
          e.preventDefault()
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveFolder, caseId])

  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 13, color: T.text, marginBottom: 12 }}>
        Documents <span style={{ fontWeight: 400, fontSize: 11.5, color: T.textFaint }}>{documents.length > 0 ? documents.length : ''}</span>
      </div>

      {loading ? (
        <div style={{ fontSize: 12.5, color: T.textFaint }}>Loading…</div>
      ) : documents.length === 0 ? (
        <div style={{ fontSize: 12.5, color: T.textFaint, fontStyle: 'italic', marginBottom: 8 }}>No documents yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {documents.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <a href={d.drive_view_url || '#'} target="_blank" rel="noopener noreferrer"
                style={{ flex: 1, fontSize: 12.5, color: T.gold, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.file_name}</a>
              <button onClick={() => removeDocument(d)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>×</button>
            </div>
          ))}
        </div>
      )}

      {drive.uploadError && <div style={{ fontSize: 11.5, color: T.rose, marginBottom: 8 }}>{drive.uploadError}</div>}

      <div
        onClick={() => (document.getElementById(`nb-file-input-${caseId}`) as HTMLInputElement)?.click()}
        onDragOver={e => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={e => { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files?.length) doUpload(e.dataTransfer.files) }}
        style={{
          cursor: 'pointer', textAlign: 'center', borderRadius: 8, padding: '14px 12px',
          border: `1.5px dashed ${dragActive ? T.gold : 'rgba(168,131,74,.5)'}`,
          background: dragActive ? T.goldSoft : 'transparent',
        }}>
        <input id={`nb-file-input-${caseId}`} type="file" multiple disabled={drive.uploading} style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.length) doUpload(e.target.files); e.target.value = '' }} />
        <p style={{ fontSize: 12, color: T.textFaint, margin: 0 }}>
          {drive.uploading ? 'Uploading…' : driveFolder ? `Paste, drag in, or click to upload to ${driveFolder.name}` : `Paste, drag in, or click — you'll be asked to pick a folder for ${clientId ? "this client's New Business documents" : 'this case'}`}
        </p>
      </div>
      {driveFolder && (
        <button onClick={connectDrive} disabled={drive.connecting}
          style={{ marginTop: 6, fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
          {drive.connecting ? 'Connecting…' : clientId ? "Change folder — applies to all this client's New Business cases" : 'Change folder for this case'}
        </button>
      )}
    </div>
  )
}