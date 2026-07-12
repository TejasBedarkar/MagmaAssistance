const FILE_PREFIX = 'chat'

export function isFolderPickerSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export async function pickChatFolder() {
  if (!isFolderPickerSupported()) {
    throw new Error('Folder access is not supported in this browser.')
  }
  return window.showDirectoryPicker()
}

export async function saveChatToFolder(folderHandle, messages) {
  const fileName = `${FILE_PREFIX}-${new Date().toISOString().slice(0, 10)}.json`
  const fileHandle = await folderHandle.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(messages, null, 2))
  await writable.close()
}
