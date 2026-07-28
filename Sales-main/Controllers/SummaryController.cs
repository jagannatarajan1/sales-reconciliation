using Microsoft.AspNetCore.Mvc;
using Sales.DTOs;
using Sales.Services;

namespace Sales.Controllers;

[ApiController]
[Route("api/[controller]")]
public class SummaryController : ControllerBase
{
    private readonly IGmailService _gmailService;

    public SummaryController(IGmailService gmailService)
    {
        _gmailService = gmailService;
    }

    [HttpGet("today")]
    public IActionResult GetToday()
    {
        var userIdObj = HttpContext.Items["UserId"];
        if (userIdObj == null)
            return Unauthorized(new { message = "User not authenticated" });

        // TODO(commit-feature): no "Commit Day" data model exists yet, so this always
        // reports not-committed until that feature is built.
        return Ok(new TodaySummaryResponse { IsCommitted = false });
    }

    [HttpGet("zreport-email")]
    public async Task<IActionResult> GetZReportEmail()
    {
        var userIdObj = HttpContext.Items["UserId"];
        if (userIdObj == null)
            return Unauthorized(new { message = "User not authenticated" });

        return await GetZReportForDateAsync(DateTime.UtcNow.Date);
    }

    [HttpGet("zreport-email/by-date")]
    public async Task<IActionResult> GetZReportEmailByDate([FromQuery] DateTime date)
    {
        var userIdObj = HttpContext.Items["UserId"];
        if (userIdObj == null)
            return Unauthorized(new { message = "User not authenticated" });

        return await GetZReportForDateAsync(date.Date);
    }

    private async Task<IActionResult> GetZReportForDateAsync(DateTime targetDate)
    {
        var email = await _gmailService.FindZReportEmailAsync(targetDate);
        if (email == null)
            return BadRequest(new { message = "No Z-report email found for this date." });

        return Ok(new ZReportResponse
        {
            IsCommitted = false,
            TargetDate = targetDate,
            Email = email
        });
    }
}
