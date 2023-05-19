import { exec } from "child_process"
import "dotenv/config"
import fs from "fs"
import path from "path"
import util from "util"

import { Octokit } from "octokit"
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

const client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
    }
})

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

const orgs = ["VSArchive", "VSWSL", "BackupRunner", "AutomationRunner"]

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
    await execAsync(`tar -cvzf - repos | split --bytes=${4*1024*1024*1024} - repos.tar.gz.`, {
        maxBuffer: 1024 * 1024 * 1024
    })

    const files = fs.readdirSync(".")

    files.forEach((file) => {
        if (file.startsWith("repos.tar.gz")) {
            const backup = fs.createReadStream(file)

            const date = new Date().getUTCDate() + "-" + (new Date().getUTCMonth() + 1) + "-" + new Date().getUTCFullYear()
            const params = {
                Bucket: process.env.AWS_BUCKET!,
                Key: `GitHub/Backup-${date}/${file}`,
                Body: backup,
                StorageClass: "DEEP_ARCHIVE"
            }

            client.send(new PutObjectCommand(params), (err, _) => {
                if (err) {
                    console.error(err)
                    process.exit(1)
                } else {
                    console.log("Backup successful")
                }
            })
        }
    })
} catch (err) {
    console.error(err)
}
