import { exec } from "child_process"
import "dotenv/config"
import fs from "fs"
import path from "path"
import util from "util"

import { Octokit } from "octokit"
import { google } from 'googleapis'
import { GoogleAuth } from 'googleapis-common'

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
const baseDir = process.env.BASE_DIR!

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

const orgs = ["VSArchive", "VSWSL"]

const cloneRepo = async (url: string) => {
    url = url.replace("https://github.com", `https://vineelsai26:${process.env.GITHUB_TOKEN}@github.com`)
    const repoPath = path.join(baseDir, url.split("/")[3], url.split("/")[4])
    const repoGitPath = path.join(repoPath, ".git")
    if (fs.existsSync(repoPath) && fs.existsSync(repoGitPath)) {
        const { stdout, stderr } = await execAsync(`cd ${repoPath} && git pull`)
        console.log(stdout, stderr)
    } else if (fs.existsSync(repoPath) && !fs.existsSync(repoGitPath)) {
        const { stdout, stderr } = await execAsync(`cd ${repoPath} && git clone ${url} .`)
        console.log(stdout, stderr)
    } else {
        fs.mkdirSync(repoPath, { recursive: true })
        const { stdout, stderr } = await execAsync(`cd ${repoPath} && git clone ${url} .`)
        console.log(stdout, stderr)
    }
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
    await execAsync(`tar --use-compress-program=pigz -cf repos.tar.gz ${baseDir}`, {
        maxBuffer: 1024 * 1024 * 1024
    })

    const SCOPES = ['https://www.googleapis.com/auth/drive.file']

    const auth = new google.auth.GoogleAuth({
        keyFile: 'credentials.json',
        scopes: SCOPES
    })

    function uploadFile(auth: GoogleAuth) {
        const drive = google.drive({ version: 'v3', auth })
 
        const media = {
            mimeType: 'image/jpeg',
            body: fs.createReadStream('repos.tar.gz')
        }
        drive.files.create({
            media: media,
            requestBody: {
                name: 'repos.tar.gz',
                parents: [
                    process.env.GOOGLE_DRIVE_FOLDER_ID!
                ],
            },
            fields: 'id,name'
        }, (err, file) => {
            if (err) {
                // Handle error
                console.error(err)
            } else {
                console.log('File Id: ', file?.data.id)
            }
        })
    }

    uploadFile(auth)

} catch (err) {
    console.error(err)
}
