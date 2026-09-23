import java.time.*;
import java.util.*;

/** Trusted authored fixture; variants are demonstration controls, not generated repairs. */
public class Witness {
  static int checks = 0;
  static int failures = 0;
  static void check(String id, String actual, String expected) {
    checks++;
    boolean passed = actual.equals(expected);
    if (!passed) failures++;
    System.out.println("ASSERT|" + id + "|" + (passed ? "PASS" : "FAIL") + "|actual=" + actual + "|expected=" + expected);
  }
  static String date(String input, boolean corrected) {
    return Instant.parse(input).atZone(corrected ? ZoneOffset.UTC : ZoneId.systemDefault()).toLocalDate().toString();
  }
  static String lower(String input, boolean corrected) {
    return corrected ? input.toLowerCase(Locale.ROOT) : input.toLowerCase();
  }
  static String order(String input, boolean corrected) {
    List<String> values = new ArrayList<>(Arrays.asList(input.split(",")));
    if (corrected) Collections.sort(values);
    return String.join(",", values);
  }
  static String mode(String explicit, boolean corrected) {
    if (explicit != null) return explicit;
    return corrected ? "strict" : System.getProperty("fixture.mode");
  }
  public static void main(String[] args) {
    String variant = args[0], scenario = args[1];
    if (variant.equals("unknown")) throw new IllegalStateException("UNCLASSIFIED_CONTROL");
    if (variant.equals("unrelated")) { check("unrelated", "crash", "ready"); finish(); return; }
    if (variant.equals("suppressed")) { finish(); return; }
    boolean corrected = variant.equals("corrected") || variant.equals("regression");
    String actual;
    switch (scenario) {
      case "timezone":
        actual = date("2026-01-01T23:30:00Z", corrected);
        check("target.timezone", actual, "2026-01-01");
        check("boundary.timezone", date("2024-02-29T12:00:00Z", corrected), "2024-02-29"); break;
      case "locale":
        actual = lower("TITLE", corrected);
        check("target.locale", actual, "title");
        check("boundary.locale", lower("Straße", corrected), "straße"); break;
      case "order":
        check("target.order", order(System.getProperty("fixture.order"), corrected), "alpha,beta");
        check("boundary.order", order("alpha,beta,gamma", corrected), "alpha,beta,gamma"); break;
      case "config":
        actual = mode(null, corrected);
        check("target.config", actual, "strict");
        check("boundary.config", mode("relaxed", corrected), "relaxed"); break;
      default: throw new IllegalArgumentException("Unknown fixture case");
    }
    check("regression.empty", "".trim(), "");
    check("regression.total", Integer.toString(2 + (variant.equals("regression") ? 3 : 2)), "4");
    finish();
  }
  static void finish() {
    System.out.println("CHECKS|" + checks + "|FAILURES|" + failures);
    if (failures > 0) System.exit(1);
  }
}
