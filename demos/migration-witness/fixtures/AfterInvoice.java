import java.math.*;
import java.time.*;

/** Authored invoice-formatting fixture; not output of a migration engine. */
public class AfterInvoice {
    public static String render(String customer, String amount, String timestamp, boolean sharedBug) {
        String name = customer.trim();
        if (name.isEmpty()) return "ERROR_CUSTOMER";
        BigDecimal total;
        try { total = new BigDecimal(amount).setScale(2, sharedBug ? RoundingMode.DOWN : RoundingMode.HALF_UP); }
        catch (NumberFormatException error) { return "ERROR_AMOUNT"; }
        LocalDate date;
        try { date = OffsetDateTime.parse(timestamp).atZoneSameInstant(ZoneOffset.UTC).toLocalDate(); }
        catch (java.time.format.DateTimeParseException error) { return "ERROR_DATE"; }
        return name + "|" + total.toPlainString() + "|" + date;
    }
}
