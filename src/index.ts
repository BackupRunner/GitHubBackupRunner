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

    // Create upload session
    dbx.filesUploadSessionStart({ close: false })
        .then(response => {
            const sessionId = response.result.session_id
            const readStream = fs.createReadStream("repos.tar.gz")
            let uploadedSize = 0
            readStream.on('data', chunk => {
                uploadedSize += chunk.length

                // Append data to upload session
                dbx.filesUploadSessionAppendV2({
                    contents: chunk,
                    cursor: {
                        session_id: sessionId,
                        offset: uploadedSize - chunk.length
                    },
                    close: false
                }).then(() => {
                    if (uploadedSize >= fs.statSync("repos.tar.gz").size) {
                        // Finalize upload session
                        dbx.filesUploadSessionFinish({
                            cursor: {
                                session_id: sessionId,
                                offset: uploadedSize
                            },
                            commit: {
                                path: `/Backup/${date}/repos.tar.gz`,
                                mode: { '.tag': 'add' },
                                autorename: false,
                                mute: false
                            }
                        }).then(response => {
                            console.log('File uploaded successfully:', response)
                        }).catch(error => {
                            console.error('Error finishing upload session:', error)
                        })
                    }
                }).catch(error => {
                    console.error('Error appending to upload session:', error)
                })
            })

            readStream.on('end', () => {
                console.log('File reading completed.')
            })

        })
        .catch(error => {
            console.error('Error starting upload session:', error)
        })
} catch (err) {
    console.error(err)
}
