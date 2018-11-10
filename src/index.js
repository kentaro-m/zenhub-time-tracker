const AppConfig = require('config')
const axios = require('axios')
const { DateTime } = require('luxon')
const querystring = require('querystring')

const { SLACK_WEBHOOK_URL, ZENHUB_API_TOKEN } = process.env

function createResponse (statusCode, body) {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json'
    }
  }
}

function buildMessage (data, config) {
  const githubHost = config.github.host || 'github.com'

  const body = {
    'attachments': [
      {
        'fallback': config.slack.message.text,
        'pretext': config.slack.message.text,
        'author_name': `${data.organization}/${data.repo}`,
        'author_link': `https://${githubHost}/${data.organization}/${data.repo}#boards`,
        'title': `Issue #${data.issueNumber} ${data.issueTitle}`,
        'title_link': data.issueUrl,
        'color': 'good',
        'fields': [
          {
            'title': 'Pipeline',
            'value': `${data.fromPipeline} to ${data.toPipeline}`,
            'short': true
          },
          {
            'title': 'Lead Time',
            'value': `${data.leadTime.toFormat("dd'd' hh'h' mm'm'")}`,
            'short': true
          }
        ]
      }
    ]
  }

  const { warn, danger } = config.slack.message.color.threshold
  const unit = config.slack.message.color.unit

  if (data.leadTime.as(unit) >= danger) {
    body.attachments[0].color = 'danger'
  } else if (data.leadTime.as(unit) >= warn) {
    body.attachments[0].color = 'warning'
  }

  return body
}

async function notifySlack (message) {
  await axios({
    method: 'POST',
    url: SLACK_WEBHOOK_URL,
    headers: {
      'Content-Type': 'application/json'
    },
    data: JSON.stringify(message)
  })
}

async function handleIssueTransferEvent (event, config) {
  const repoId = config.zenhub.repoId
  const zenhubHost = config.zenhub.host || 'api.zenhub.io'

  const issueEvents = await axios({
    method: 'GET',
    url: `https://${zenhubHost}/p1/repositories/${repoId}/issues/${event.issue_number}/events`,
    headers: {
      'X-Authentication-Token': ZENHUB_API_TOKEN
    }
  })

  const sliceData = issueEvents.data.slice(0, 2)
  const endDate = DateTime.fromISO(sliceData[0].created_at)
  const startDate = DateTime.fromISO(sliceData[1].created_at)
  const diff = endDate.diff(startDate)

  const message = buildMessage({
    organization: event.organization,
    repo: event.repo,
    issueNumber: event.issue_number,
    issueTitle: event.issue_title,
    issueUrl: event.github_url,
    toPipeline: event.to_pipeline_name,
    fromPipeline: event.from_pipeline_name,
    leadTime: diff
  }, config)

  await notifySlack(message)
}

exports.handler = async (event) => {
  try {
    const body = querystring.parse(event.body)
    console.log(body)

    if (body.type === 'issue_transfer') {
      await handleIssueTransferEvent(body, AppConfig)
    }

    return createResponse(200, {})
  } catch (error) {
    console.log(error)
    return createResponse(500, error)
  }
}
