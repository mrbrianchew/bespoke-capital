'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'

// Extracted from src/app/dashboard/servicing/claims/page.tsx so the Claims
// Board's edit-in-place modal (src/app/dashboard/business/claims/page.tsx)
// can upload directly into a claim without duplicating the OAuth/Picker/
// upload/delete mechanics. Behavior is unchanged from the original —
// advisor's own Google account via GIS token client, drive.file scope only
// (never broader Drive access), folder remembered per-client on
// clients.drive_folder_link, every network call has a hard timeout so a
// stalled request surfaces as an error instead of an unkillable spinner.
//
// Unlike the per-client page (one activeClient for the whole page session),
// the Board can open this for a DIFFERENT client every time a different
// card's modal is opened — so the picked folder is loaded fresh per
// clientId/driveFolder Link pair rather than once on mount.

export interface DriveDocument {
  id: string
  claim_id: string
  line_item_id: string | null
  file_name: string
  mime_type: string | null
  file_size: number | null
  drive_file_id: string | null
  drive_view_url: string | null
  uploaded_at: string
}

export function useDriveUpload() {
  const supabase = createClient()
  const [googleReady, setGoogleReady] = useState(false)
  const [pickerReady, setPickerReady] = useState(false)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const tokenClientRef = useRef<any>(null)
  const [connecting, setConnecting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  function initGoogleTokenClient() {
    try {
      const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
      if (!clientId) { console.error('[drive] NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set'); return }
      tokenClientRef.current = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: () => {},
      })
      setGoogleReady(true)
    } catch (err) {
      console.error('[drive] Failed to init Google token client:', err)
    }
  }

  useEffect(() => {
    try {
      if ((window as any).google?.accounts?.oauth2) {
        initGoogleTokenClient()
      } else {
        const s = document.createElement('script')
        s.src = 'https://accounts.google.com/gsi/client'
        s.async = true
        s.onload = initGoogleTokenClient
        s.onerror = () => console.error('[drive] Failed to load Google Identity Services script')
        document.body.appendChild(s)
      }

      if ((window as any).gapi?.picker) {
        setPickerReady(true)
      } else {
        const s = document.createElement('script')
        s.src = 'https://apis.google.com/js/api.js'
        s.async = true
        s.onload = () => {
          try {
            (window as any).gapi.load('picker', () => setPickerReady(true))
          } catch (err) {
            console.error('[drive] Failed to load Picker library:', err)
          }
        }
        s.onerror = () => console.error('[drive] Failed to load Google API loader script')
        document.body.appendChild(s)
      }
    } catch (err) {
      console.error('[drive] Google script setup failed:', err)
    }
  }, [])

  async function ensureAccessToken(interactive = false): Promise<string> {
    if (accessToken && !interactive) return accessToken
    if (!tokenClientRef.current) throw new Error('Google Sign-In is still loading — try again in a moment.')
    const requestOnce = (prompt: string): Promise<string> => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('__silent_timeout__')), 12000)
      tokenClientRef.current.callback = (resp: any) => {
        clearTimeout(timer)
        if (resp.error) { reject(new Error(resp.error)); return }
        setAccessToken(resp.access_token)
        resolve(resp.access_token)
      }
      tokenClientRef.current.requestAccessToken({ prompt })
    })
    if (!interactive) {
      try {
        return await requestOnce('')
      } catch (err: any) {
        if (err?.message !== '__silent_timeout__') throw err
      }
    }
    try {
      return await requestOnce('consent')
    } catch (err: any) {
      if (err?.message === '__silent_timeout__') throw new Error('Google sign-in did not respond — check that popups are allowed for this site, then try again.')
      throw err
    }
  }

  async function pickFolder(): Promise<{ id: string; name: string } | null> {
    if (!pickerReady) throw new Error('Google Drive picker is still loading — try again in a moment.')
    const token = await ensureAccessToken()
    const g = (window as any).google
    return new Promise(resolve => {
      const view = new g.picker.DocsView(g.picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true)
        .setMimeTypes('application/vnd.google-apps.folder')
      const picker = new g.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY)
        .setCallback((data: any) => {
          if (data.action === g.picker.Action.PICKED) {
            const doc = data.docs[0]
            resolve({ id: doc.id, name: doc.name })
          } else if (data.action === g.picker.Action.CANCEL) {
            resolve(null)
          }
        })
        .build()
      picker.setVisible(true)
    })
  }

  // Picks (or changes) the folder for a specific client and remembers it on
  // clients.drive_folder_link. Returns the picked folder, or null if the
  // advisor cancelled, so the caller can update its own local state.
  async function connectDriveForClient(clientId: string): Promise<{ id: string; name: string } | null> {
    setConnecting(true)
    setUploadError(null)
    try {
      const folder = await pickFolder()
      if (!folder) return null
      const raw = JSON.stringify(folder)
      const { error } = await supabase.from('clients').update({ drive_folder_link: raw, updated_at: new Date().toISOString() }).eq('id', clientId)
      if (error) { setUploadError('Could not remember this folder: ' + error.message); return null }
      return folder
    } catch (err: any) {
      setUploadError(err?.message || 'Could not connect to Drive')
      return null
    } finally {
      setConnecting(false)
    }
  }

  async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number, label: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, { ...opts, signal: controller.signal })
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s — check your connection and try again.`)
      throw new Error(`${label} failed: ${err?.message || 'network error'}`)
    } finally {
      clearTimeout(timer)
    }
  }

  async function uploadDocument(file: File, claimId: string, lineItemId: string | null, folder: { id: string; name: string }): Promise<DriveDocument | null> {
    setUploading(true)
    setUploadError(null)
    try {
      const token = await ensureAccessToken()
      const initRes = await fetchWithTimeout('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ name: file.name, parents: [folder.id] }),
      }, 20000, 'Starting the upload')
      if (!initRes.ok) throw new Error('Could not start upload (status ' + initRes.status + ')')
      const uploadUrl = initRes.headers.get('Location')
      if (!uploadUrl) throw new Error('Drive did not return an upload session — this can happen if the browser blocked reading the response. Try a different browser if this repeats.')

      const putRes = await fetchWithTimeout(uploadUrl, {
        method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
      }, 120000, 'Uploading the file')
      if (!putRes.ok) throw new Error('Upload to Drive failed (status ' + putRes.status + ')')
      const driveFile = await putRes.json()

      const { data, error } = await supabase.from('claim_documents').insert({
        claim_id: claimId, line_item_id: lineItemId,
        file_name: driveFile.name || file.name, mime_type: file.type || null,
        file_size: driveFile.size ? +driveFile.size : file.size,
        drive_file_id: driveFile.id, drive_view_url: driveFile.webViewLink || null,
      }).select().maybeSingle()
      if (error || !data) throw new Error(error?.message || 'Uploaded to Drive but could not save the record')
      return data as DriveDocument
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed')
      return null
    } finally {
      setUploading(false)
    }
  }

  async function uploadFiles(files: FileList | File[], claimId: string, lineItemId: string | null, folder: { id: string; name: string }): Promise<DriveDocument[]> {
    const uploaded: DriveDocument[] = []
    for (const f of Array.from(files)) {
      const doc = await uploadDocument(f, claimId, lineItemId, folder)
      if (doc) uploaded.push(doc)
    }
    return uploaded
  }

  async function deleteDocument(doc: Pick<DriveDocument, 'id' | 'file_name' | 'drive_file_id'>): Promise<boolean> {
    if (!window.confirm(`Delete "${doc.file_name}"? This removes it from Drive too.`)) return false
    try {
      if (doc.drive_file_id) {
        const token = await ensureAccessToken()
        await fetch(`https://www.googleapis.com/drive/v3/files/${doc.drive_file_id}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        })
      }
    } catch { /* proceed to remove the app-side record regardless */ }
    const { error } = await supabase.from('claim_documents').delete().eq('id', doc.id)
    if (error) { alert('Delete failed: ' + error.message); return false }
    return true
  }

  return {
    googleReady, pickerReady, connecting, uploading, uploadError, setUploadError,
    ensureAccessToken, pickFolder, connectDriveForClient, uploadFiles, deleteDocument,
  }
}