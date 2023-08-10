import { exec } from "child_process"
import "dotenv/config"
import fs from "fs"
import path from "path"
import util from "util"

import { Octokit } from "octokit"
import { Dropbox } from "dropbox"

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
const baseDir = process.env.BASE_DIR!
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN!

var dbx = new Dropbox({ accessToken: DROPBOX_ACCESS_TOKEN })

const execAsync = util.promisify(exec)

interface UserData {
    user: {
        repositories: {
            nodes: Array<{
                url: string
            }>
        }
    }
}

interface OrganizationData {
    organization: {
        repositories: {
            nodes: Array<{
                url: string
            }>
        }
    }
}

const users = ["vineelsai26"]

const orgs = ["VSArchive", "VSWSL", "BackupRunner", "AutomationRunner", "VSPlayStore"]

const cloneRepo = async (url: string) => {
    url = url.replace("https://github.com", `https://vineelsai26:${process.env.GITHUB_TOKEN}@github.com`)
    const repoBasePath = path.join(baseDir, url.split("/")[3])
    fs.mkdirSync(repoBasePath, { recursive: true })
    const { stdout, stderr } = await execAsync(`cd ${repoBasePath} && git clone --mirror ${url}`)
    console.log(stdout, stderr)
}

const run = async () => {
    for await (const user of users) {
        const userData: UserData = await octokit.graphql(`query {
			user(login: "${user}") {
				repositories(first: 100 ownerAffiliations: OWNER) {
					nodes {
						url
					}
				}
			}
		}`)

        for await (const repo of userData.user.repositories.nodes) {
            await cloneRepo(repo.url)
        }
    }

    for await (const org of orgs) {
        const organizationData: OrganizationData = await octokit.graphql(`query {
			organization(login: "${org}") {
				repositories(first: 100 ownerAffiliations: OWNER) {
					nodes {
						url
					}
				}
			}
		}`)

        organizationData.organization.repositories.nodes.map((repo) => {
            cloneRepo(repo.url)
        })
    }
}

await run()

try {
    await execAsync(`tar --use-compress-program=pigz -cf repos.tar.gz repos`, {
        maxBuffer: 1024 * 1024 * 1024
    })

    const date = new Date().getUTCDate() + "-" + (new Date().getUTCMonth() + 1) + "-" + new Date().getUTCFullYear()
    const FILE_PATH = "repos.tar.gz"
    const DROPBOX_UPLOAD_PATH = `/repos-${date.toLowerCase()}.tar.gz`

    // Open the file and get its size
    fs.stat(FILE_PATH, (err, stats) => {
        if (err) {
            console.error('Error opening file:', err)
            return
        }

        const fileSize = stats.size
        const chunkSize = 100 * 1024 * 1024 // 5MB
        const numChunks = Math.ceil(fileSize / chunkSize)

        // Start a new upload session
        dbx.filesUploadSessionStart({ close: false })
            .then(response => {
                const sessionId = response.result.session_id
                let cursorPosition = 0
                let chunkIndex = 0

                function uploadNextChunk() {
                    const chunkBuffer = Buffer.alloc(chunkSize)
                    const bytesRead = fs.readSync(fs.openSync(FILE_PATH, 'r'), chunkBuffer, 0, chunkSize, cursorPosition)

                    cursorPosition += bytesRead

                    // Append data to the upload session
                    dbx.filesUploadSessionAppendV2({
                        contents: chunkBuffer.subarray(0, bytesRead),
                        cursor: {
                            session_id: sessionId,
                            offset: chunkIndex * chunkSize
                        }
                    }).then(() => {
                        chunkIndex++
                        if (chunkIndex < numChunks) {
                            uploadNextChunk()
                        } else {
                            // Finish the upload session
                            dbx.filesUploadSessionFinish({
                                cursor: {
                                    session_id: sessionId,
                                    offset: fileSize
                                },
                                commit: {
                                    path: DROPBOX_UPLOAD_PATH,
                                    autorename: true,
                                    mute: false
                                }
                            }).then(_ => {
                                console.log('File uploaded successfully:')
                            }).catch(error => {
                                console.error('Error finishing upload session:', error)
                            })
                        }
                    }).catch(error => {
                        console.error('Error appending to upload session:', error)
                        process.exit(1)
                    })
                }

                uploadNextChunk()
            })
            .catch(error => {
                console.error('Error starting upload session:', error)
                process.exit(1)
            })
    })
} catch (err) {
    console.error(err)
    process.exit(1)
}
